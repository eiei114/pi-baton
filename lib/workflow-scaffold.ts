import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toKebabCase } from "./kebab-case.ts";
import { ensureParentDir, getPackageWorkflowsDir, workflowFilePath } from "./paths.ts";

const FAST_MODEL_PLACEHOLDER = "<your-fast-model>";
const STRONG_MODEL_PLACEHOLDER = "<your-strong-model>";

export class WorkflowNameCollisionError extends Error {
  readonly filename: string;

  constructor(filename: string) {
    super(`Workflow filename already exists: ${filename}`);
    this.name = "WorkflowNameCollisionError";
    this.filename = filename;
  }
}

export function deriveWorkflowFilename(displayName: string): string {
  const filename = `${toKebabCase(displayName)}.yaml`;
  if (!filename || filename === ".yaml") {
    throw new Error("Workflow name must contain letters or numbers");
  }
  return filename;
}

export function buildDerivedScaffoldYaml(builtinYaml: string): string {
  const lines = builtinYaml.split(/\r?\n/);
  const output: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("name:")) {
      output.push(line);
      continue;
    }

    if (/^\s{2}implement:\s*$/.test(line) || /^\s{2}fix:\s*$/.test(line)) {
      output.push(line);
      continue;
    }

    if (/^\s{4}agent:\s+worker\s*$/.test(line)) {
      output.push(line);
      const indent = line.match(/^(\s+)/)?.[1] ?? "    ";
      output.push(`${indent}model: ${FAST_MODEL_PLACEHOLDER}`);
      continue;
    }

    if (/^\s{4}agent:\s+reviewer\s*$/.test(line)) {
      output.push(line);
      const indent = line.match(/^(\s+)/)?.[1] ?? "    ";
      output.push(`${indent}model: ${STRONG_MODEL_PLACEHOLDER}`);
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

export async function createWorkflowScaffold(
  cwd: string,
  displayName: string,
): Promise<{ filePath: string; filename: string; content: string }> {
  const filename = deriveWorkflowFilename(displayName);
  const filePath = workflowFilePath(cwd, filename);

  try {
    await access(filePath);
    throw new WorkflowNameCollisionError(filename);
  } catch (error) {
    if (error instanceof WorkflowNameCollisionError) throw error;
  }

  const builtinPath = join(getPackageWorkflowsDir(), "default-review-loop.yaml");
  const builtinYaml = await readFile(builtinPath, "utf8");
  let content = buildDerivedScaffoldYaml(builtinYaml);

  content = content.replace(/^name:.*$/m, `name: ${displayName.trim()}`);

  await ensureParentDir(filePath);
  await writeFile(filePath, content, "utf8");

  return { filePath, filename, content };
}

export function isModelPlaceholder(model: string | undefined): boolean {
  if (!model) return false;
  const trimmed = model.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">");
}
