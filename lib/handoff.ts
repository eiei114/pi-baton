import type { RunManifest, StepHandoffPayload, StructuredStepEnvelope } from "./types.ts";

export function buildRunMetadata(manifest: RunManifest): StepHandoffPayload["runMetadata"] {
  return {
    runId: manifest.id,
    workflowName: manifest.workflowName,
    currentIteration: manifest.iteration,
    targetDirectory: manifest.targetDirectory,
  };
}

export function buildImplementHandoff(manifest: RunManifest): StepHandoffPayload {
  return {
    taskBrief: manifest.taskBrief,
    runMetadata: buildRunMetadata(manifest),
  };
}

export function buildLinearHandoff(
  manifest: RunManifest,
  previousEnvelope: StructuredStepEnvelope,
): StepHandoffPayload {
  return {
    taskBrief: manifest.taskBrief,
    stepOutputSummary: previousEnvelope.summary,
    rawOutputPath: previousEnvelope.rawOutputPath,
    runMetadata: buildRunMetadata(manifest),
  };
}

export function buildFixHandoff(
  manifest: RunManifest,
  previousEnvelope: StructuredStepEnvelope,
  reviewFindings: string[],
): StepHandoffPayload {
  return {
    taskBrief: manifest.taskBrief,
    reviewFindings,
    previousOutputSummary: previousEnvelope.summary,
    rawOutputPath: previousEnvelope.rawOutputPath,
    runMetadata: buildRunMetadata(manifest),
  };
}

export function formatHandoffForPrompt(handoff: StepHandoffPayload): string {
  const lines = [
    "## Task brief",
    handoff.taskBrief,
    "",
    "## Run metadata",
    `- run id: ${handoff.runMetadata.runId}`,
    `- workflow: ${handoff.runMetadata.workflowName}`,
    `- iteration: ${handoff.runMetadata.currentIteration}`,
    `- target directory: ${handoff.runMetadata.targetDirectory}`,
  ];

  if (handoff.stepOutputSummary) {
    lines.push("", "## Previous step summary", handoff.stepOutputSummary);
  }

  if (handoff.previousOutputSummary) {
    lines.push("", "## Previous output summary", handoff.previousOutputSummary);
  }

  if (handoff.rawOutputPath) {
    lines.push("", "## Raw output path", handoff.rawOutputPath);
  }

  if (handoff.reviewFindings?.length) {
    lines.push("", "## Review findings");
    for (const finding of handoff.reviewFindings) {
      lines.push(`- ${finding}`);
    }
  }

  return lines.join("\n");
}

export function buildStepPrompt(stepPrompt: string, handoff: StepHandoffPayload): string {
  return `${stepPrompt.trim()}\n\n---\n\n${formatHandoffForPrompt(handoff)}`;
}
