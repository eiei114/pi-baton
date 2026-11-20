import { type ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { findAgent } from "./agents.ts";
import { isModelPlaceholder } from "./workflow-scaffold.ts";
import type { StepExecutionRequest, StepExecutionResult, StepRunner } from "./types.ts";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function getFinalOutput(messages: Message[]): string {
  const assistantTexts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "text") assistantTexts.push(block.text);
    }
  }

  return assistantTexts.join("\n").trim();
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-baton-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  });
  return { dir: tmpDir, filePath };
}

/** Minimal child-process surface used by the subagent runner. */
export type SubagentProcess = Pick<ChildProcess, "stdout" | "stderr" | "kill" | "on">;

export interface SubagentRunnerOptions {
  /** Process spawner; defaults to node:child_process spawn. Injectable for tests. */
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => SubagentProcess;
  /** Grace period between SIGTERM and the SIGKILL fallback after an abort. */
  killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 5000;

export function createSubagentRunner(options: SubagentRunnerOptions = {}): StepRunner {
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  return async (request: StepExecutionRequest): Promise<StepExecutionResult> => {
    const agent = findAgent(request.cwd, request.agent);
    if (!agent) {
      return {
        exitCode: 1,
        outputText: "",
        stderr: `Unknown agent: "${request.agent}"`,
      };
    }

    const args: string[] = ["--mode", "json", "-p", "--no-session"];

    const requestedModel = request.model && !isModelPlaceholder(request.model) ? request.model : undefined;
    const agentModel = agent.model && !isModelPlaceholder(agent.model) ? agent.model : undefined;
    const model = requestedModel ?? agentModel;
    if (model) {
      args.push("--model", model);
    }

    if (agent.tools?.length) {
      args.push("--tools", agent.tools.join(","));
    }

    let tmpPromptDir: string | null = null;
    let tmpPromptPath: string | null = null;

    try {
      if (agent.systemPrompt.trim()) {
        const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
        tmpPromptDir = tmp.dir;
        tmpPromptPath = tmp.filePath;
        args.push("--append-system-prompt", tmpPromptPath);
      }

      args.push(request.prompt);

      let stderr = "";
      const messages: Message[] = [];
      let resolvedModel: string | undefined = model;

      const exitCode = await new Promise<number>((resolve) => {
        const invocation = getPiInvocation(args);
        const proc = spawnProcess(invocation.command, invocation.args, {
          cwd: request.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let buffer = "";
        // `proc.killed` only reports that a signal was delivered, not that the
        // process exited, so track the actual exit for the SIGKILL fallback.
        let exited = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;

        const onAbort = () => {
          if (exited) return;
          proc.kill("SIGTERM");
          if (killTimer || exited) return;
          killTimer = setTimeout(() => {
            killTimer = undefined;
            if (!exited) proc.kill("SIGKILL");
          }, killGraceMs);
        };

        const markExited = () => {
          exited = true;
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = undefined;
          }
        };

        const cleanup = () => {
          markExited();
          request.signal?.removeEventListener("abort", onAbort);
        };

        const processLine = (line: string) => {
          if (!line.trim()) return;
          let event: { type?: string; message?: Message };
          try {
            event = JSON.parse(line) as { type?: string; message?: Message };
          } catch {
            return;
          }

          if (event.type === "message_end" && event.message) {
            messages.push(event.message);
            if (event.message.role === "assistant" && "model" in event.message && event.message.model) {
              resolvedModel = String(event.message.model);
            }
          }
        };

        proc.stdout?.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) processLine(line);
        });

        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("exit", markExited);

        proc.on("close", (code) => {
          cleanup();
          if (buffer.trim()) processLine(buffer);
          resolve(code ?? 0);
        });

        proc.on("error", () => {
          cleanup();
          resolve(1);
        });

        if (request.signal) {
          if (request.signal.aborted) onAbort();
          else request.signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      return {
        exitCode,
        outputText: getFinalOutput(messages),
        stderr,
        model: resolvedModel,
      };
    } finally {
      if (tmpPromptPath) {
        try {
          fs.unlinkSync(tmpPromptPath);
        } catch {
          // ignore
        }
      }
      if (tmpPromptDir) {
        try {
          fs.rmdirSync(tmpPromptDir);
        } catch {
          // ignore
        }
      }
    }
  };
}

export function createEchoStepRunner(): StepRunner {
  return async (request) => ({
    exitCode: 0,
    outputText: request.prompt,
    stderr: "",
    model: request.model,
  });
}

export function shortenHome(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
