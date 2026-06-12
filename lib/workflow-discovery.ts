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

export async function loadWorkflowById(cwd: string, workflowId: string): Promise<WorkflowDefinition> {
  const items = await discoverWorkflowItems(cwd);
  const match = items.find((item) => item.id === workflowId);
  if (!match) {
    throw new Error(`Unknown workflow: ${workflowId}`);
  }

  const yamlText = await readFile(match.path, "utf8");
  return parseWorkflowDocument(yamlText, {
    id: match.id,
    source: match.source,
    path: match.path,
  });
}

export async function loadWorkflowFromPath(
  filePath: string,
  options: { id: string; source: "user" | "builtin" },
): Promise<WorkflowDefinition> {
  const yamlText = await readFile(filePath, "utf8");
  return parseWorkflowDocument(yamlText, { ...options, path: filePath });
}
