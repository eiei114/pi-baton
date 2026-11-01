import type { RunState } from "./types.ts";

export function isTerminalRunState(state: unknown): state is Extract<RunState, "completed" | "failed"> {
  return state === "completed" || state === "failed";
}
