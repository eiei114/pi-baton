import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ensureBatonScaffolding,
  ensureRunDirs,
  getActiveRunPointerPath,
  getRunManifestPath,
  getRunStepsDir,
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

export async function loadActiveRun(cwd: string): Promise<RunManifest | null> {
  const pointer = await readActiveRunPointer(cwd);
  if (!pointer) return null;

  try {
    const manifest = await readRunManifest(cwd, pointer.runId);
    if (manifest.state === "completed" || manifest.state === "failed") {
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

export async function clearActiveRunPointer(cwd: string): Promise<void> {
  await writeJson(getActiveRunPointerPath(cwd), { runId: null });
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
