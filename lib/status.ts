import type { TerminalRunHistoryResult } from "./run-store.ts";
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

  if (manifest.failureReason) {
    lines.push(`failure: ${manifest.failureReason}`);
  }

  return lines.join("\n");
}

export const NO_ACTIVE_RUN_MESSAGE =
  "No active Baton run. Start one with /baton:start after choosing a workflow and task brief.";

export const NO_TERMINAL_HISTORY_MESSAGE =
  "No completed or failed Baton runs yet. Start one with /baton:start, then /baton:run.";

function formatRelativeRunDirectory(runId: string): string {
  return `.pi/baton/runs/${runId}`.replace(/\\/g, "/");
}

function formatHistoryRow(manifest: RunManifest): string {
  const lastStep = manifest.lastStep ?? "(none)";
  return [
    manifest.state,
    manifest.id,
    manifest.workflowName,
    `last: ${lastStep}`,
    `iter: ${manifest.iteration}`,
    `updated: ${manifest.updatedAt}`,
    formatRelativeRunDirectory(manifest.id),
  ].join(" | ");
}

export function formatHistorySummary(result: TerminalRunHistoryResult): string {
  const lines: string[] = [];

  if (result.runs.length === 0) {
    lines.push(NO_TERMINAL_HISTORY_MESSAGE);
  } else {
    for (const manifest of result.runs) {
      lines.push(formatHistoryRow(manifest));
    }
  }

  if (result.skippedCount > 0) {
    lines.push(`(${result.skippedCount} run(s) skipped: unreadable or incomplete manifest)`);
  }

  return lines.join("\n");
}
