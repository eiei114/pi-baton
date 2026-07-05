import type { RunManifest } from "./types.ts";

function isTerminalRunState(state: RunManifest["state"]): boolean {
  return state === "completed" || state === "failed";
}

export function formatStatusSummary(manifest: RunManifest): string {
  const lines: string[] = [];

  if (isTerminalRunState(manifest.state)) {
    lines.push(`This Baton run has finished (${manifest.state}).`);
  }

  lines.push(
    `workflow: ${manifest.workflowName}`,
    `task brief: ${manifest.taskBrief}`,
    `last step: ${manifest.lastStep ?? "(none)"}`,
    `current step: ${manifest.currentStep ?? "(none)"}`,
    `run state: ${manifest.state}`,
    `iteration count: ${manifest.iteration}`,
    `run directory: .pi/baton/runs/${manifest.id}`,
  );

  return lines.join("\n");
}

export const NO_ACTIVE_RUN_MESSAGE =
  "No active Baton run. Start one with /baton:start after choosing a workflow and task brief.";
