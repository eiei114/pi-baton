import type { RunManifest } from "./types.ts";

export function formatStatusSummary(manifest: RunManifest): string {
  return [
    `workflow: ${manifest.workflowName}`,
    `task brief: ${manifest.taskBrief}`,
    `last step: ${manifest.lastStep ?? "(none)"}`,
    `current step: ${manifest.currentStep ?? "(none)"}`,
    `run state: ${manifest.state}`,
    `iteration count: ${manifest.iteration}`,
    `run directory: .pi/baton/runs/${manifest.id}`,
  ].join("\n");
}

export const NO_ACTIVE_RUN_MESSAGE =
  "No active Baton run. Start one with /baton:start after choosing a workflow and task brief.";
