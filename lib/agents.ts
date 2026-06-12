import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getPackageAgentsDir } from "./paths.ts";
import type { WorkflowDefinition } from "./types.ts";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project" | "builtin";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export class MissingAgentsError extends Error {
  readonly missing: string[];
  readonly available: string[];

  constructor(missing: string[], available: string[]) {
    const availableText = available.length > 0 ? available.join(", ") : "none";
    super(
      `Missing Pi subagents: ${missing.join(", ")}. Available agents: ${availableText}. ` +
        "Add agents under .pi/agents/ or use the pi-baton builtin worker/reviewer agents.",
    );
    this.name = "MissingAgentsError";
    this.missing = missing;
    this.available = available;
  }
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope = "both"): AgentConfig[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const builtinDir = getPackageAgentsDir();

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
  const builtinAgents = loadAgentsFromDir(builtinDir, "builtin");

  const agentMap = new Map<string, AgentConfig>();

  for (const agent of builtinAgents) agentMap.set(agent.name, agent);
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  return Array.from(agentMap.values());
}

export function findAgent(cwd: string, agentName: string): AgentConfig | undefined {
  return discoverAgents(cwd, "both").find((agent) => agent.name === agentName);
}

export function listRequiredAgents(workflow: WorkflowDefinition): string[] {
  return [...new Set(Object.values(workflow.steps).map((step) => step.agent))].sort();
}

export function validateWorkflowAgents(cwd: string, workflow: WorkflowDefinition): void {
  const required = listRequiredAgents(workflow);
  const available = discoverAgents(cwd, "both");
  const availableNames = available.map((agent) => agent.name);
  const missing = required.filter((name) => !availableNames.includes(name));

  if (missing.length > 0) {
    throw new MissingAgentsError(missing, availableNames);
  }
}
