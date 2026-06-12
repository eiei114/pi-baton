export type RunState = "idle" | "running" | "completed" | "failed";

export type ReviewJudgment = "accept" | "reject";

export interface WorkflowLinearStep {
  kind: "linear";
  name: string;
  agent: string;
  prompt: string;
  model?: string;
  next: string;
}

export interface WorkflowReviewStep {
  kind: "review";
  name: string;
  agent: string;
  prompt: string;
  model?: string;
  on_accept: string;
  on_reject: string;
}

export type WorkflowStep = WorkflowLinearStep | WorkflowReviewStep;

export interface WorkflowDefinition {
  id: string;
  source: "user" | "builtin";
  path: string;
  name: string;
  iteration_cap: number;
  steps: Record<string, WorkflowStep>;
  entryStep: string;
}

export interface WorkflowListItem {
  id: string;
  name: string;
  source: "user" | "builtin";
  path: string;
}

export interface RunMetadata {
  runId: string;
  workflowName: string;
  currentIteration: number;
  targetDirectory: string;
}

export interface StepHandoffPayload {
  taskBrief: string;
  stepOutputSummary?: string;
  rawOutputPath?: string;
  runMetadata: RunMetadata;
  reviewFindings?: string[];
  previousOutputSummary?: string;
}

export interface StructuredStepEnvelope {
  summary: string;
  rawOutputPath: string;
  judgment?: ReviewJudgment;
  findings?: string[];
  acceptanceNote?: string;
}

export interface StepRecord {
  stepName: string;
  iteration: number;
  agent: string;
  model?: string;
  startedAt: string;
  finishedAt: string;
  envelope: StructuredStepEnvelope;
  exitCode: number;
  error?: string;
}

export interface RunManifest {
  id: string;
  state: RunState;
  workflowId: string;
  workflowName: string;
  workflowPath: string;
  workflowSource: "user" | "builtin";
  taskBrief: string;
  targetDirectory: string;
  entryStep: string;
  currentStep: string | null;
  lastStep: string | null;
  iteration: number;
  iterationCap: number;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface ActiveRunPointer {
  runId: string;
}

export interface StepExecutionRequest {
  agent: string;
  prompt: string;
  model?: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface StepExecutionResult {
  exitCode: number;
  outputText: string;
  stderr: string;
  model?: string;
}

export type StepRunner = (request: StepExecutionRequest) => Promise<StepExecutionResult>;
