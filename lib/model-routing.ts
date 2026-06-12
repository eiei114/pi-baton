import type { Model } from "@earendil-works/pi-ai";
import { isModelPlaceholder } from "./workflow-scaffold.ts";

export function resolveStepModel(
  stepModel: string | undefined,
  sessionModel: Model<any> | undefined,
): string | undefined {
  if (stepModel && !isModelPlaceholder(stepModel)) {
    return stepModel;
  }

  if (!sessionModel) return undefined;
  return `${sessionModel.provider}/${sessionModel.id}`;
}
