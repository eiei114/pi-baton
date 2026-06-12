import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  buildFixHandoff,
  buildImplementHandoff,
  buildLinearHandoff,
  buildStepPrompt,
} from "./handoff.ts";
import { getRunOutputsDir } from "./paths.ts";
import { resolveStepModel } from "./model-routing.ts";
import { ReviewContractError, parseStepEnvelope } from "./review-contract.ts";
import { readRunManifest, updateRunState, writeStepRecord } from "./run-store.ts";
import { loadWorkflowFromPath } from "./workflow-discovery.ts";
import { isCompleteTransition } from "./workflow-schema.ts";
import type { RunProgressUpdate } from "./run-widget.ts";
import type {
  RunManifest,
  StepRecord,
  StepRunner,
  StructuredStepEnvelope,
  WorkflowDefinition,
  WorkflowStep,
} from "./types.ts";

export interface RunEngineOptions {
  cwd: string;
  runId: string;
  stepRunner: StepRunner;
  sessionModel?: Model<any>;
  signal?: AbortSignal;
  onProgress?: (update: RunProgressUpdate) => void;
}

export interface RunResultSummary {
  state: RunManifest["state"];
  lastStep: string | null;
  iteration: number;
  runDirectory: string;
  failureReason?: string;
}

function outputFileName(stepName: string, iteration: number): string {
  return `${stepName}-${iteration}.md`;
}

async function saveRawOutput(
  cwd: string,
  runId: string,
  stepName: string,
  iteration: number,
  text: string,
): Promise<string> {
  const filePath = join(getRunOutputsDir(cwd, runId), outputFileName(stepName, iteration));
  await writeFile(filePath, text, "utf8");
  return filePath;
}

function buildHandoff(
  stepName: string,
  manifest: RunManifest,
  previousEnvelope?: StructuredStepEnvelope,
) {
  if (stepName === "implement") {
    return buildImplementHandoff(manifest);
  }

  if (stepName === "fix" && previousEnvelope) {
    return buildFixHandoff(manifest, previousEnvelope, previousEnvelope.findings ?? []);
  }

  if (previousEnvelope) {
    return buildLinearHandoff(manifest, previousEnvelope);
  }

  return buildImplementHandoff(manifest);
}

function resolveNextStep(step: WorkflowStep, envelope: StructuredStepEnvelope): string | null {
  if (step.kind === "linear") {
    return step.next;
  }

  if (envelope.judgment === "accept") {
    return isCompleteTransition(step.on_accept) ? null : step.on_accept;
  }

  return step.on_reject;
}

function emitProgress(options: RunEngineOptions, update: RunProgressUpdate): void {
  options.onProgress?.(update);
}

async function executeOneStep(
  options: RunEngineOptions,
  workflow: WorkflowDefinition,
  manifest: RunManifest,
  stepName: string,
  previousEnvelope?: StructuredStepEnvelope,
): Promise<StructuredStepEnvelope> {
  const step = workflow.steps[stepName];
  if (!step) {
    throw new Error(`Unknown step: ${stepName}`);
  }

  emitProgress(options, {
    phase: "step-start",
    manifest,
    workflow,
    stepName,
    step,
  });

  const handoff = buildHandoff(stepName, manifest, previousEnvelope);
  const prompt = buildStepPrompt(step.prompt, handoff);
  const model = resolveStepModel(step.model, options.sessionModel);
  const startedAt = new Date().toISOString();
  const iteration = manifest.iteration;

  const result = await options.stepRunner({
    agent: step.agent,
    prompt,
    model,
    cwd: manifest.targetDirectory,
    signal: options.signal,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Step ${stepName} failed with exit code ${result.exitCode}`);
  }

  const rawOutputPath = await saveRawOutput(
    options.cwd,
    options.runId,
    stepName,
    iteration,
    result.outputText,
  );

  const envelope = parseStepEnvelope(result.outputText, rawOutputPath, {
    isReviewStep: step.kind === "review",
  });

  const record: StepRecord = {
    stepName,
    iteration,
    agent: step.agent,
    model: result.model ?? model,
    startedAt,
    finishedAt: new Date().toISOString(),
    envelope,
    exitCode: result.exitCode,
  };

  await writeStepRecord(options.cwd, options.runId, record);
  return envelope;
}

export async function runContinuous(options: RunEngineOptions): Promise<RunResultSummary> {
  let manifest = await readRunManifest(options.cwd, options.runId);

  if (manifest.state === "completed" || manifest.state === "failed") {
    throw new Error(`Run ${manifest.id} is terminal (${manifest.state})`);
  }

  if (manifest.state !== "idle" && manifest.state !== "running") {
    throw new Error(`Run ${manifest.id} cannot be executed from state ${manifest.state}`);
  }

  manifest = await updateRunState(options.cwd, manifest.id, { state: "running" });
  const workflow = await loadWorkflowFromPath(manifest.workflowPath, {
    id: manifest.workflowId,
    source: manifest.workflowSource,
  });

  emitProgress(options, {
    phase: "run-start",
    manifest,
    workflow,
  });

  let currentStep = manifest.currentStep ?? manifest.entryStep;
  let lastEnvelope: StructuredStepEnvelope | undefined;

  try {
    while (currentStep) {
      const step = workflow.steps[currentStep];
      if (!step) {
        throw new Error(`Unknown step: ${currentStep}`);
      }

      if (step.kind === "review" && manifest.iteration >= manifest.iterationCap) {
        manifest = await updateRunState(options.cwd, manifest.id, {
          state: "failed",
          failureReason: `Iteration cap (${manifest.iterationCap}) reached`,
          lastStep: manifest.lastStep,
          currentStep,
        });
        break;
      }

      const envelope = await executeOneStep(options, workflow, manifest, currentStep, lastEnvelope);
      const nextStep = resolveNextStep(step, envelope);
      const terminal = nextStep === null;

      let nextIteration = manifest.iteration;
      if (step.kind === "review" && envelope.judgment === "reject") {
        nextIteration += 1;
      }

      manifest = await updateRunState(options.cwd, manifest.id, {
        lastStep: currentStep,
        currentStep: terminal ? null : nextStep,
        iteration: nextIteration,
        state: terminal ? "completed" : "running",
      });

      emitProgress(options, {
        phase: "step-done",
        manifest,
        workflow,
        stepName: currentStep,
        step,
        envelope,
      });

      lastEnvelope = envelope;

      if (terminal) {
        break;
      }

      currentStep = nextStep;
    }
  } catch (error) {
    const failureReason =
      error instanceof ReviewContractError || error instanceof Error
        ? error.message
        : String(error);

    manifest = await updateRunState(options.cwd, manifest.id, {
      state: "failed",
      failureReason,
      lastStep: manifest.lastStep,
      currentStep,
    });
  }

  const runDirectory = join(options.cwd, ".pi", "baton", "runs", manifest.id);

  const result: RunResultSummary = {
    state: manifest.state,
    lastStep: manifest.lastStep,
    iteration: manifest.iteration,
    runDirectory,
    failureReason: manifest.failureReason,
  };

  emitProgress(options, {
    phase: "run-end",
    manifest,
    workflow,
    result,
  });

  return result;
}

export function formatRunResultSummary(summary: RunResultSummary): string {
  const lines = [
    `state: ${summary.state}`,
    `last step: ${summary.lastStep ?? "(none)"}`,
    `iteration count: ${summary.iteration}`,
    `run directory: ${summary.runDirectory}`,
  ];

  if (summary.failureReason) {
    lines.push(`failure: ${summary.failureReason}`);
  }

  return lines.join("\n");
}
