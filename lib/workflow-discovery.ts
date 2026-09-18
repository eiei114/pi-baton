import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getPackageWorkflowsDir, getWorkflowsDir } from "./paths.ts";
import type { WorkflowDefinition, WorkflowListItem } from "./types.ts";
import { parseWorkflowDocument } from "./workflow-schema.ts";

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

export async function discoverWorkflowItems(cwd: string): Promise<WorkflowListItem[]> {
  const userFiles = await listYamlFiles(getWorkflowsDir(cwd));
  const builtinFiles = await listYamlFiles(getPackageWorkflowsDir());

  const userItems: WorkflowListItem[] = [];
  for (const filePath of userFiles) {
    const yamlText = await readFile(filePath, "utf8");
    const id = basename(filePath, ".yaml");
    const workflow = parseWorkflowDocument(yamlText, { id, source: "user", path: filePath });
    userItems.push({ id, name: workflow.name, source: "user", path: filePath });
  }

  const builtinItems: WorkflowListItem[] = [];
  for (const filePath of builtinFiles) {
    const yamlText = await readFile(filePath, "utf8");
    const id = basename(filePath, ".yaml");
    const workflow = parseWorkflowDocument(yamlText, { id, source: "builtin", path: filePath });
    builtinItems.push({ id, name: workflow.name, source: "builtin", path: filePath });
  }

  return [...userItems, ...builtinItems];
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

const UNSAFE_WORKFLOW_ID_PATTERN = /[\\/\0]/;

function isSafeWorkflowId(workflowId: string): boolean {
  return (
    workflowId.length > 0 &&
    workflowId !== "." &&
    workflowId !== ".." &&
    !UNSAFE_WORKFLOW_ID_PATTERN.test(workflowId)
  );
}

export async function loadWorkflowById(cwd: string, workflowId: string): Promise<WorkflowDefinition> {
  // The direct lookup builds a path from the id, so ids that could escape the
  // workflow directories are rejected before any read is attempted.
  if (!isSafeWorkflowId(workflowId)) {
    throw new Error(`Unknown workflow: ${workflowId}`);
  }

  const userPath = join(getWorkflowsDir(cwd), `${workflowId}.yaml`);
  try {
    const yamlText = await readFile(userPath, "utf8");
    return parseWorkflowDocument(yamlText, { id: workflowId, source: "user", path: userPath });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const builtinPath = join(getPackageWorkflowsDir(), `${workflowId}.yaml`);
  try {
    const yamlText = await readFile(builtinPath, "utf8");
    return parseWorkflowDocument(yamlText, { id: workflowId, source: "builtin", path: builtinPath });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  throw new Error(`Unknown workflow: ${workflowId}`);
}

export async function loadWorkflowFromPath(
  filePath: string,
  options: { id: string; source: "user" | "builtin" },
): Promise<WorkflowDefinition> {
  const yamlText = await readFile(filePath, "utf8");
  return parseWorkflowDocument(yamlText, { ...options, path: filePath });
}
