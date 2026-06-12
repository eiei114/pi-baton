import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { findAgent } from "./agents.ts";
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
  const assistantTexts = messages
    .filter((message): message is Extract<Message, { role: "assistant" }> => message.role === "assistant")
    .flatMap((message) =>
      message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text),
    );

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

export function createSubagentRunner(): StepRunner {
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

    const model = request.model ?? agent.model;
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
        const proc = spawn(invocation.command, invocation.args, {
          cwd: request.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let buffer = "";

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

        proc.stdout.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) processLine(line);
        });

        proc.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          if (buffer.trim()) processLine(buffer);
          resolve(code ?? 0);
        });

        proc.on("error", () => resolve(1));

        if (request.signal) {
          const kill = () => {
            proc.kill("SIGTERM");
            setTimeout(() => {
              if (!proc.killed) proc.kill("SIGKILL");
            }, 5000);
          };
          if (request.signal.aborted) kill();
          else request.signal.addEventListener("abort", kill, { once: true });
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
