import { readdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ensureBatonScaffolding,
  ensureRunDirs,
  getActiveRunPointerPath,
  getRunManifestPath,
  getRunStepsDir,
  getRunsDir,
} from "./paths.ts";
import type { ActiveRunPointer, RunManifest, RunState, StepRecord } from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class ActiveRunGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActiveRunGuardError";
  }
}

export async function readActiveRunPointer(cwd: string): Promise<ActiveRunPointer | null> {
  try {
    return await readJson<ActiveRunPointer>(getActiveRunPointerPath(cwd));
  } catch {
    return null;
  }
}

export async function readRunManifest(cwd: string, runId: string): Promise<RunManifest> {
  return readJson<RunManifest>(getRunManifestPath(cwd, runId));
}

function isTerminalRunState(state: RunState): boolean {
  return state === "completed" || state === "failed";
}

export async function loadActiveRun(cwd: string): Promise<RunManifest | null> {
  const pointer = await readActiveRunPointer(cwd);
  if (!pointer?.runId) return null;

  try {
    const manifest = await readRunManifest(cwd, pointer.runId);
    if (isTerminalRunState(manifest.state)) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export const TERMINAL_HISTORY_DEFAULT_LIMIT = 10;
export const TERMINAL_HISTORY_HARD_CAP = 20;
export const TERMINAL_HISTORY_MAX_SCAN = 200;

export interface TerminalRunHistoryResult {
  runs: RunManifest[];
  skippedCount: number;
}

function isCompleteManifest(value: unknown): value is RunManifest {
  if (!value || typeof value !== "object") return false;

  const manifest = value as Partial<RunManifest>;
  return (
    typeof manifest.id === "string" &&
    typeof manifest.state === "string" &&
    typeof manifest.workflowName === "string" &&
    typeof manifest.updatedAt === "string" &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.iteration === "number" &&
    (manifest.lastStep === null || typeof manifest.lastStep === "string")
  );
}

function runIdTimestamp(runId: string): string {
  const prefix = runId.slice(0, 14);
  return /^\d{14}$/.test(prefix) ? prefix : "";
}

function compareRunIdsNewestFirst(a: string, b: string): number {
  const aTimestamp = runIdTimestamp(a);
  const bTimestamp = runIdTimestamp(b);
  if (aTimestamp && bTimestamp && aTimestamp !== bTimestamp) {
    return bTimestamp.localeCompare(aTimestamp);
  }

  return b.localeCompare(a);
}

function compareRunsNewestFirst(a: RunManifest, b: RunManifest): number {
  const updatedCompare = b.updatedAt.localeCompare(a.updatedAt);
  if (updatedCompare !== 0) return updatedCompare;

  const createdCompare = b.createdAt.localeCompare(a.createdAt);
  if (createdCompare !== 0) return createdCompare;

  return compareRunIdsNewestFirst(a.id, b.id);
}

export async function loadTerminalRunHistory(
  cwd: string,
  options: { limit?: number } = {},
): Promise<TerminalRunHistoryResult> {
  await ensureBatonScaffolding(cwd);

  const limit = Math.min(
    Math.max(1, options.limit ?? TERMINAL_HISTORY_DEFAULT_LIMIT),
    TERMINAL_HISTORY_HARD_CAP,
  );

  let entries;
  try {
    entries = await readdir(getRunsDir(cwd), { withFileTypes: true });
  } catch {
    return { runs: [], skippedCount: 0 };
  }

  const runIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareRunIdsNewestFirst)
    .slice(0, TERMINAL_HISTORY_MAX_SCAN);

  const scanResults = await Promise.all(
    runIds.map(async (runId) => {
      try {
        const manifest = await readJson<unknown>(getRunManifestPath(cwd, runId));
        if (!isCompleteManifest(manifest)) {
          return { kind: "skipped" as const };
        }
        if (!isTerminalRunState(manifest.state)) {
          return { kind: "non-terminal" as const };
        }
        return { kind: "terminal" as const, manifest };
      } catch {
        return { kind: "skipped" as const };
      }
    }),
  );

  const terminalRuns: RunManifest[] = [];
  let skippedCount = 0;

  for (const result of scanResults) {
    if (result.kind === "skipped") {
      skippedCount++;
      continue;
    }
    if (result.kind === "terminal") {
      terminalRuns.push(result.manifest);
    }
  }

  terminalRuns.sort(compareRunsNewestFirst);

  return {
    runs: terminalRuns.slice(0, limit),
    skippedCount,
  };
}

export async function loadMostRecentTerminalRun(cwd: string): Promise<RunManifest | null> {
  const pointer = await readActiveRunPointer(cwd);
  if (!pointer?.runId) return null;

  try {
    const manifest = await readRunManifest(cwd, pointer.runId);
    if (!isTerminalRunState(manifest.state)) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export async function saveRunManifest(cwd: string, manifest: RunManifest): Promise<void> {
  manifest.updatedAt = nowIso();
  await writeJson(getRunManifestPath(cwd, manifest.id), manifest);
}

export async function setActiveRunPointer(cwd: string, runId: string): Promise<void> {
  await writeJson(getActiveRunPointerPath(cwd), { runId } satisfies ActiveRunPointer);
}

export interface CreateRunInput {
  workflowId: string;
  workflowName: string;
  workflowPath: string;
  workflowSource: "user" | "builtin";
  taskBrief: string;
  targetDirectory: string;
  entryStep: string;
  iterationCap: number;
}

export async function createIdleRun(cwd: string, input: CreateRunInput): Promise<RunManifest> {
  await ensureBatonScaffolding(cwd);

  const active = await loadActiveRun(cwd);
  if (active) {
    throw new ActiveRunGuardError(
      `Active run ${active.id} is ${active.state}. Use /baton:status or /baton:run before starting a new run.`,
    );
  }

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const runId = `${timestamp}-${randomUUID().slice(0, 8)}`;
  await ensureRunDirs(cwd, runId);

  const manifest: RunManifest = {
    id: runId,
    state: "idle",
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    workflowPath: input.workflowPath,
    workflowSource: input.workflowSource,
    taskBrief: input.taskBrief,
    targetDirectory: input.targetDirectory,
    entryStep: input.entryStep,
    currentStep: input.entryStep,
    lastStep: null,
    iteration: 0,
    iterationCap: input.iterationCap,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await saveRunManifest(cwd, manifest);
  await setActiveRunPointer(cwd, runId);
  return manifest;
}

export async function updateRunState(
  cwd: string,
  runId: string,
  patch: Partial<RunManifest> & { state?: RunState },
): Promise<RunManifest> {
  const manifest = await readRunManifest(cwd, runId);
  const next = { ...manifest, ...patch, updatedAt: nowIso() };
  await saveRunManifest(cwd, next);
  return next;
}

export async function writeStepRecord(cwd: string, runId: string, record: StepRecord): Promise<string> {
  const fileName = `${record.stepName}-${record.iteration}-${record.finishedAt.replace(/[:.]/g, "")}.json`;
  const filePath = `${getRunStepsDir(cwd, runId)}/${fileName}`;
  await writeJson(filePath, record);
  return filePath;
}
