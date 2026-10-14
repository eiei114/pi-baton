import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { getRunManifestPath, getRunStepsDir } from "./paths.ts";
import { isCompleteRunManifest } from "./run-store.ts";
import type { RunManifest, ReviewJudgment } from "./types.ts";

export const INSPECTION_MAX_STEP_FILES = 100;
export const INSPECTION_MAX_STEP_FILE_BYTES = 64 * 1024;
export const INSPECTION_MAX_RECORDS = 50;
export const INSPECTION_MAX_FINDINGS_PER_STEP = 5;
export const INSPECTION_MAX_TEXT_CODE_POINTS = 240;
export const INSPECTION_MAX_OUTPUT_CODE_POINTS = 6_000;

const OUTPUT_DIAGNOSTIC_RESERVE = 500;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface InspectedStepRecord {
  filename: string;
  stepName: string;
  iteration: number;
  startedAt?: string;
  summary: string;
  judgment?: ReviewJudgment;
  findings?: string[];
  acceptanceNote?: string;
}

export interface RunInspection {
  runId: string;
  records: InspectedStepRecord[];
  skippedFileCount: number;
  uninspectedFileCount: number;
  omittedRecordCount: number;
  stepsUnavailable: boolean;
}

export type SelectedRunInspection =
  | { status: "stale" }
  | { status: "ready"; inspection: RunInspection };

type ReadableFileHandle = Pick<FileHandle, "stat" | "read" | "close">;

export interface InspectionFileSystem {
  readFile(filePath: string): Promise<Buffer>;
  readdir(directoryPath: string): Promise<Dirent[]>;
  lstat(filePath: string): Promise<Stats>;
  open(filePath: string): Promise<ReadableFileHandle>;
}

const STEP_OPEN_FLAGS =
  typeof fsConstants.O_NOFOLLOW === "number"
    ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    : fsConstants.O_RDONLY;

const defaultFileSystem: InspectionFileSystem = {
  readFile,
  readdir: (directoryPath) => readdir(directoryPath, { withFileTypes: true }),
  lstat,
  open: (filePath) => open(filePath, STEP_OPEN_FLAGS),
};

interface ParsedStepRecord extends InspectedStepRecord {
  timestamp: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseStepRecord(value: unknown, filename: string): ParsedStepRecord | null {
  if (!isRecord(value) || typeof value.stepName !== "string" || !value.stepName.trim()) {
    return null;
  }
  if (!Number.isSafeInteger(value.iteration) || (value.iteration as number) < 0) {
    return null;
  }
  if (!isRecord(value.envelope) || typeof value.envelope.summary !== "string") {
    return null;
  }

  const record: ParsedStepRecord = {
    filename,
    stepName: value.stepName,
    iteration: value.iteration as number,
    summary: value.envelope.summary,
    timestamp: parseTimestamp(value.startedAt) ?? parseTimestamp(value.finishedAt),
  };

  if (typeof value.startedAt === "string") record.startedAt = value.startedAt;
  if (value.envelope.judgment === "accept" || value.envelope.judgment === "reject") {
    record.judgment = value.envelope.judgment;
  }
  if (Array.isArray(value.envelope.findings)) {
    record.findings = value.envelope.findings.filter(
      (finding): finding is string => typeof finding === "string",
    );
  }
  if (typeof value.envelope.acceptanceNote === "string") {
    record.acceptanceNote = value.envelope.acceptanceNote;
  }

  return record;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareStepRecords(a: ParsedStepRecord, b: ParsedStepRecord): number {
  if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  if (a.timestamp !== null && b.timestamp === null) return -1;
  if (a.timestamp === null && b.timestamp !== null) return 1;
  if (a.iteration !== b.iteration) return a.iteration - b.iteration;
  const filenameOrder = compareText(a.filename, b.filename);
  if (filenameOrder !== 0) return filenameOrder;
  return compareText(a.stepName, b.stepName);
}

function isTerminalManifest(value: unknown, runId: string): value is RunManifest {
  return (
    isCompleteRunManifest(value) &&
    value.id === runId &&
    (value.state === "completed" || value.state === "failed")
  );
}

async function readBoundedFile(
  filePath: string,
  fileSystem: InspectionFileSystem,
): Promise<{ text: string } | { skipped: true }> {
  let handle: ReadableFileHandle | undefined;
  try {
    const initialStats = await fileSystem.lstat(filePath);
    if (
      !initialStats.isFile()
      || initialStats.isSymbolicLink()
      || initialStats.size > INSPECTION_MAX_STEP_FILE_BYTES
    ) {
      return { skipped: true };
    }

    handle = await fileSystem.open(filePath);
    const openedStats = await handle.stat();
    if (
      !openedStats.isFile()
      || openedStats.isSymbolicLink()
      || openedStats.size > INSPECTION_MAX_STEP_FILE_BYTES
    ) {
      return { skipped: true };
    }

    const buffer = Buffer.alloc(INSPECTION_MAX_STEP_FILE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > INSPECTION_MAX_STEP_FILE_BYTES) return { skipped: true };
    return { text: buffer.subarray(0, bytesRead).toString("utf8") };
  } catch {
    return { skipped: true };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // A failed close must not suppress other step records.
      }
    }
  }
}

/** Reads the exact selected run and its structured steps, never run outputs. */
export async function inspectSelectedRun(
  cwd: string,
  runId: string,
  fileSystem: InspectionFileSystem = defaultFileSystem,
): Promise<SelectedRunInspection> {
  if (!SAFE_RUN_ID.test(runId)) return { status: "stale" };

  let manifest: unknown;
  try {
    const text = await fileSystem.readFile(getRunManifestPath(cwd, runId));
    manifest = JSON.parse(text.toString("utf8")) as unknown;
  } catch {
    return { status: "stale" };
  }
  if (!isTerminalManifest(manifest, runId)) return { status: "stale" };

  try {
    const stepsDirStats = await fileSystem.lstat(getRunStepsDir(cwd, runId));
    if (stepsDirStats.isSymbolicLink()) {
      return {
        status: "ready",
        inspection: {
          runId,
          records: [],
          skippedFileCount: 0,
          uninspectedFileCount: 0,
          omittedRecordCount: 0,
          stepsUnavailable: true,
        },
      };
    }
  } catch {
    return {
      status: "ready",
      inspection: {
        runId,
        records: [],
        skippedFileCount: 0,
        uninspectedFileCount: 0,
        omittedRecordCount: 0,
        stepsUnavailable: true,
      },
    };
  }

  let entries: Dirent[];
  try {
    entries = await fileSystem.readdir(getRunStepsDir(cwd, runId));
  } catch {
    return {
      status: "ready",
      inspection: {
        runId,
        records: [],
        skippedFileCount: 0,
        uninspectedFileCount: 0,
        omittedRecordCount: 0,
        stepsUnavailable: true,
      },
    };
  }

  const filenames = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort(compareText);
  const inspectedFilenames = filenames.slice(0, INSPECTION_MAX_STEP_FILES);
  const records: ParsedStepRecord[] = [];
  let skippedFileCount = 0;

  for (const filename of inspectedFilenames) {
    const file = await readBoundedFile(
      join(getRunStepsDir(cwd, runId), filename),
      fileSystem,
    );
    if ("skipped" in file) {
      skippedFileCount++;
      continue;
    }

    try {
      const record = parseStepRecord(JSON.parse(file.text) as unknown, filename);
      if (!record) {
        skippedFileCount++;
        continue;
      }
      records.push(record);
    } catch {
      skippedFileCount++;
    }
  }

  records.sort(compareStepRecords);
  return {
    status: "ready",
    inspection: {
      runId,
      records: records.slice(0, INSPECTION_MAX_RECORDS),
      skippedFileCount,
      uninspectedFileCount: Math.max(0, filenames.length - inspectedFilenames.length),
      omittedRecordCount: Math.max(0, records.length - INSPECTION_MAX_RECORDS),
      stepsUnavailable: false,
    },
  };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeText(value: string): { text: string; truncated: boolean } {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(normalized);
  if (points.length <= INSPECTION_MAX_TEXT_CODE_POINTS) {
    return { text: normalized, truncated: false };
  }
  return {
    text: points.slice(0, INSPECTION_MAX_TEXT_CODE_POINTS).join(""),
    truncated: true,
  };
}

function boundedCount(value: number): string {
  return value > 999_999 ? "999999+" : String(value);
}

function stepLines(record: InspectedStepRecord): { lines: string[]; shortenedTextCount: number } {
  const normalizedName = normalizeText(record.stepName);
  const normalizedSummary = normalizeText(record.summary);
  let shortenedTextCount = Number(normalizedName.truncated) + Number(normalizedSummary.truncated);
  const lines = [
    `- iteration ${record.iteration} | step: ${normalizedName.text}`,
    `  summary: ${normalizedSummary.text}`,
  ];

  if (record.judgment) lines.push(`  review: ${record.judgment}`);
  if (record.judgment === "reject" && record.findings) {
    const findings = record.findings.slice(0, INSPECTION_MAX_FINDINGS_PER_STEP);
    for (const finding of findings) {
      const normalizedFinding = normalizeText(finding);
      shortenedTextCount += Number(normalizedFinding.truncated);
      lines.push(`  finding: ${normalizedFinding.text}`);
    }
  } else if (record.judgment === "accept" && record.acceptanceNote !== undefined) {
    const normalizedNote = normalizeText(record.acceptanceNote);
    shortenedTextCount += Number(normalizedNote.truncated);
    lines.push(`  acceptance note: ${normalizedNote.text}`);
  }

  return { lines, shortenedTextCount };
}

export function formatRunInspection(inspection: RunInspection): string {
  const lines = [`Step summaries for run ${inspection.runId}:`];
  let omittedFindingCount = 0;
  let shortenedTextCount = 0;
  let outputOmittedRecordCount = 0;

  if (inspection.records.length === 0) {
    lines.push(
      inspection.stepsUnavailable
        ? "Step records are unavailable for this run. Raw output was not opened; use /baton:history to choose another run."
        : "No valid structured step summaries are available. Raw output was not opened; use /baton:history to choose another run.",
    );
  } else {
    for (let index = 0; index < inspection.records.length; index++) {
      const record = inspection.records[index];
      const block = stepLines(record);
      const currentLength = codePointLength(lines.join("\n"));
      const blockLength = codePointLength(block.lines.join("\n")) + 1;
      if (currentLength + blockLength > INSPECTION_MAX_OUTPUT_CODE_POINTS - OUTPUT_DIAGNOSTIC_RESERVE) {
        outputOmittedRecordCount = inspection.records.length - index;
        break;
      }

      lines.push(...block.lines);
      shortenedTextCount += block.shortenedTextCount;
      if (record.judgment === "reject" && record.findings) {
        omittedFindingCount += Math.max(0, record.findings.length - INSPECTION_MAX_FINDINGS_PER_STEP);
      }
    }
  }

  const omittedRecordCount = inspection.omittedRecordCount + outputOmittedRecordCount;
  lines.push(
    `Limits: skipped files=${boundedCount(inspection.skippedFileCount)}; uninspected files=${boundedCount(inspection.uninspectedFileCount)}; records omitted=${boundedCount(omittedRecordCount)}; findings omitted=${boundedCount(omittedFindingCount)}; text items shortened=${boundedCount(shortenedTextCount)}.`,
  );

  // The reserved diagnostic space makes this a defensive final guard, including Unicode code points.
  const output = lines.join("\n");
  const points = Array.from(output);
  if (points.length <= INSPECTION_MAX_OUTPUT_CODE_POINTS) return output;
  return points.slice(0, INSPECTION_MAX_OUTPUT_CODE_POINTS).join("");
}

export function formatRunInspectionChoice(manifest: RunManifest, index: number): string {
  const state = normalizeText(manifest.state).text;
  const workflow = normalizeText(manifest.workflowName).text;
  const updatedAt = normalizeText(manifest.updatedAt).text;
  const runId = normalizeText(manifest.id).text;
  return `${index + 1}. ${state} | ${workflow} | updated: ${updatedAt} | run: ${runId}`;
}
