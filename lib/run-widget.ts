import type { RunManifest, StructuredStepEnvelope, WorkflowDefinition, WorkflowStep } from "./types.ts";
import type { RunResultSummary } from "./run-engine.ts";

export type RunProgressPhase = "run-start" | "step-start" | "step-done" | "run-end";

export interface RunProgressUpdate {
  phase: RunProgressPhase;
  manifest: RunManifest;
  workflow: WorkflowDefinition;
  stepName?: string;
  step?: WorkflowStep;
  envelope?: StructuredStepEnvelope;
  result?: RunResultSummary;
}

function truncate(text: string, max = 72): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

function stepLabel(stepName: string, step?: WorkflowStep): string {
  if (!step) return stepName;
  const kind = step.kind === "review" ? "review" : "linear";
  return `${stepName} (${step.agent}, ${kind})`;
}

export function buildRunWidgetLines(update: RunProgressUpdate): string[] {
  const { manifest, workflow, phase, stepName, step, envelope, result } = update;
  const lines: string[] = ["Baton run"];

  lines.push(`workflow: ${manifest.workflowName}`);
  lines.push(`brief: ${truncate(manifest.taskBrief)}`);
  lines.push(`iteration: ${manifest.iteration}/${manifest.iterationCap}`);

  if (phase === "run-start") {
    lines.push("status: starting...");
    return lines;
  }

  if (phase === "step-start" && stepName) {
    lines.push(`status: running ${stepLabel(stepName, step)}`);
    if (step?.model) lines.push(`model: ${step.model}`);
    return lines;
  }

  if (phase === "step-done" && stepName) {
    lines.push(`status: finished ${stepLabel(stepName, step)}`);
    if (envelope?.summary) lines.push(`summary: ${truncate(envelope.summary, 96)}`);
    if (envelope?.judgment) {
      lines.push(`judgment: ${envelope.judgment}`);
      if (envelope.judgment === "reject" && envelope.findings?.length) {
        lines.push(`findings: ${envelope.findings.length}`);
      }
    }
    if (manifest.currentStep) {
      lines.push(`next: ${manifest.currentStep}`);
    }
    return lines;
  }

  if (phase === "run-end" && result) {
    lines.push(`status: ${result.state}`);
    lines.push(`last step: ${result.lastStep ?? "(none)"}`);
    if (result.failureReason) lines.push(`failure: ${truncate(result.failureReason, 96)}`);
    return lines;
  }

  lines.push(`state: ${manifest.state}`);
  if (manifest.currentStep) lines.push(`current step: ${manifest.currentStep}`);
  return lines;
}

export function buildRunStatusText(update: RunProgressUpdate): string | undefined {
  const { phase, manifest, stepName, result } = update;

  if (phase === "run-start") return "baton: starting";
  if (phase === "step-start" && stepName) return `baton: ${stepName}`;
  if (phase === "step-done" && stepName) return `baton: ${stepName} done`;
  if (phase === "run-end" && result) {
    return result.state === "completed" ? "baton: completed" : "baton: failed";
  }

  if (manifest.state === "running" && manifest.currentStep) {
    return `baton: ${manifest.currentStep}`;
  }

  return undefined;
}

export function listWorkflowSteps(workflow: WorkflowDefinition): string[] {
  return Object.keys(workflow.steps);
}

export function buildRunStepChecklist(
  workflow: WorkflowDefinition,
  update: RunProgressUpdate,
): string[] {
  const steps = listWorkflowSteps(workflow);
  const current = update.stepName ?? update.manifest.currentStep ?? "";
  const last = update.manifest.lastStep ?? "";

  return steps.map((name) => {
    if (name === current && update.phase === "step-start") return `> ${name}`;
    if (last === name || (update.phase === "step-done" && update.stepName === name)) {
      return `✓ ${name}`;
    }
    return `  ${name}`;
  });
}
