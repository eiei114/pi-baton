import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition, WorkflowReviewStep, WorkflowStep } from "./types.ts";

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

const COMPLETE_TOKEN = "_complete";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkflowValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkflowValidationError("model must be a non-empty string when provided");
  }
  return value.trim();
}

function parseStep(name: string, raw: unknown): WorkflowStep {
  if (!isRecord(raw)) {
    throw new WorkflowValidationError(`steps.${name} must be an object`);
  }

  const agent = requireString(raw.agent, `steps.${name}.agent`);
  const prompt = requireString(raw.prompt, `steps.${name}.prompt`);
  const model = optionalString(raw.model);
  const hasNext = raw.next !== undefined;
  const hasAccept = raw.on_accept !== undefined;
  const hasReject = raw.on_reject !== undefined;

  if (hasNext && (hasAccept || hasReject)) {
    throw new WorkflowValidationError(`steps.${name} cannot mix next with review branches`);
  }

  if (!hasNext && !(hasAccept && hasReject)) {
    throw new WorkflowValidationError(
      `steps.${name} must define next or both on_accept and on_reject`,
    );
  }

  if (hasNext) {
    return {
      kind: "linear",
      name,
      agent,
      prompt,
      model,
      next: requireString(raw.next, `steps.${name}.next`),
    };
  }

  return {
    kind: "review",
    name,
    agent,
    prompt,
    model,
    on_accept: requireString(raw.on_accept, `steps.${name}.on_accept`),
    on_reject: requireString(raw.on_reject, `steps.${name}.on_reject`),
  };
}

export function parseWorkflowDocument(
  yamlText: string,
  options: { id: string; source: "user" | "builtin"; path: string },
): WorkflowDefinition {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`Invalid YAML: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new WorkflowValidationError("Workflow root must be an object");
  }

  const name = requireString(parsed.name, "name");
  const iterationCapRaw = parsed.iteration_cap;
  if (iterationCapRaw === undefined) {
    throw new WorkflowValidationError("iteration_cap is required");
  }
  if (typeof iterationCapRaw !== "number" || !Number.isInteger(iterationCapRaw) || iterationCapRaw < 1) {
    throw new WorkflowValidationError("iteration_cap must be a positive integer");
  }

  if (!isRecord(parsed.steps) || Object.keys(parsed.steps).length === 0) {
    throw new WorkflowValidationError("steps must be a non-empty object");
  }

  const steps: Record<string, WorkflowStep> = {};
  for (const [stepName, stepValue] of Object.entries(parsed.steps)) {
    steps[stepName] = parseStep(stepName, stepValue);
  }

  validateTransitions(steps);

  const entryStep = Object.keys(steps)[0];
  return {
    id: options.id,
    source: options.source,
    path: options.path,
    name,
    iteration_cap: iterationCapRaw,
    steps,
    entryStep,
  };
}

function validateTransitions(steps: Record<string, WorkflowStep>): void {
  const stepNames = new Set(Object.keys(steps));

  for (const step of Object.values(steps)) {
    if (step.kind === "linear") {
      if (!stepNames.has(step.next)) {
        throw new WorkflowValidationError(`steps.${step.name}.next references unknown step "${step.next}"`);
      }
      continue;
    }

    if (step.on_accept !== COMPLETE_TOKEN && !stepNames.has(step.on_accept)) {
      throw new WorkflowValidationError(
        `steps.${step.name}.on_accept references unknown step "${step.on_accept}"`,
      );
    }
    if (!stepNames.has(step.on_reject)) {
      throw new WorkflowValidationError(
        `steps.${step.name}.on_reject references unknown step "${step.on_reject}"`,
      );
    }
  }
}

export function isCompleteTransition(target: string): boolean {
  return target === COMPLETE_TOKEN;
}

export function getReviewStep(step: WorkflowStep): WorkflowReviewStep | undefined {
  return step.kind === "review" ? step : undefined;
}
