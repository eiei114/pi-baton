import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function getBatonRoot(cwd: string): string {
  return join(cwd, ".pi", "baton");
}

export function getWorkflowsDir(cwd: string): string {
  return join(getBatonRoot(cwd), "workflows");
}

export function getRunsDir(cwd: string): string {
  return join(getBatonRoot(cwd), "runs");
}

export function getActiveRunPointerPath(cwd: string): string {
  return join(getBatonRoot(cwd), "active-run.json");
}

export function getPackageWorkflowsDir(): string {
  return join(PACKAGE_ROOT, "workflows");
}

export function getPackageAgentsDir(): string {
  return join(PACKAGE_ROOT, "agents");
}

export async function ensureBatonScaffolding(cwd: string): Promise<void> {
  await mkdir(getWorkflowsDir(cwd), { recursive: true });
  await mkdir(getRunsDir(cwd), { recursive: true });
}

export function getRunDir(cwd: string, runId: string): string {
  return join(getRunsDir(cwd), runId);
}

export function getRunManifestPath(cwd: string, runId: string): string {
  return join(getRunDir(cwd, runId), "run.json");
}

export function getRunStepsDir(cwd: string, runId: string): string {
  return join(getRunDir(cwd, runId), "steps");
}

export function getRunOutputsDir(cwd: string, runId: string): string {
  return join(getRunDir(cwd, runId), "outputs");
}

export async function ensureRunDirs(cwd: string, runId: string): Promise<void> {
  await mkdir(getRunStepsDir(cwd, runId), { recursive: true });
  await mkdir(getRunOutputsDir(cwd, runId), { recursive: true });
}

export function workflowFilePath(cwd: string, filename: string): string {
  return join(getWorkflowsDir(cwd), filename);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}
