import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { MissingAgentsError, validateWorkflowAgents } from "../lib/agents.ts";
import { ensureBatonScaffolding } from "../lib/paths.ts";
import { formatRunResultSummary, runContinuous } from "../lib/run-engine.ts";
import { createRunUiController } from "../lib/run-ui.ts";
import {
  ActiveRunGuardError,
  createIdleRun,
  loadActiveRun,
  loadMostRecentTerminalRun,
} from "../lib/run-store.ts";
import { NO_ACTIVE_RUN_MESSAGE, formatStatusSummary } from "../lib/status.ts";
import { createSubagentRunner } from "../lib/subagent-runner.ts";
import { WorkflowNameCollisionError, createWorkflowScaffold } from "../lib/workflow-scaffold.ts";
import { WorkflowValidationError } from "../lib/workflow-schema.ts";
import { discoverWorkflowItems, loadWorkflowById } from "../lib/workflow-discovery.ts";

function requireUi(ctx: ExtensionCommandContext): boolean {
  if (ctx.hasUI) return true;
  ctx.ui.notify("Pi Baton commands require interactive UI.", "warning");
  return false;
}

async function openWorkflowEditor(ctx: ExtensionCommandContext, filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const edited = await ctx.ui.editor(`Edit workflow: ${basename(filePath)}`, content);
  if (edited !== undefined && edited !== content) {
    await writeFile(filePath, edited, "utf8");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("baton:new", {
    description: "Create a derived workflow scaffold from default-review-loop",
    handler: async (_args, ctx) => {
      if (!requireUi(ctx)) return;

      try {
        await ensureBatonScaffolding(ctx.cwd);

        while (true) {
          const displayName = await ctx.ui.input("Workflow name:", "My Review Loop");
          if (displayName === undefined) return;

          const trimmed = displayName.trim();
          if (!trimmed) {
            ctx.ui.notify("Workflow name is required.", "warning");
            continue;
          }

          try {
            const { filePath } = await createWorkflowScaffold(ctx.cwd, trimmed);
            await openWorkflowEditor(ctx, filePath);
            ctx.ui.notify(`Created workflow scaffold: ${filePath}`, "info");
            return;
          } catch (error) {
            if (error instanceof WorkflowNameCollisionError) {
              ctx.ui.notify(`${error.message}. Choose a different name.`, "warning");
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to create workflow scaffold: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("baton:start", {
    description: "Create an idle Baton run from a workflow and task brief",
    handler: async (_args, ctx) => {
      if (!requireUi(ctx)) return;

      try {
        await ensureBatonScaffolding(ctx.cwd);

        const workflows = await discoverWorkflowItems(ctx.cwd);
        if (workflows.length === 0) {
          ctx.ui.notify("No workflows found. Run /baton:new first.", "warning");
          return;
        }

        const labels = workflows.map((workflow) => workflow.name);
        const selectedName = await ctx.ui.select("Choose workflow:", labels);
        if (!selectedName) return;

        const workflowItem = workflows.find((workflow) => workflow.name === selectedName);
        if (!workflowItem) return;

        const workflow = await loadWorkflowById(ctx.cwd, workflowItem.id);
        validateWorkflowAgents(ctx.cwd, workflow);

        const taskBrief = await ctx.ui.input("Task brief:", "");
        if (taskBrief === undefined) return;

        const trimmedBrief = taskBrief.trim();
        if (!trimmedBrief) {
          ctx.ui.notify("Task brief is required.", "warning");
          return;
        }

        const manifest = await createIdleRun(ctx.cwd, {
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowPath: workflow.path,
          workflowSource: workflow.source,
          taskBrief: trimmedBrief,
          targetDirectory: ctx.cwd,
          entryStep: workflow.entryStep,
          iterationCap: workflow.iteration_cap,
        });

        ctx.ui.notify(
          `Idle run created (${manifest.id}). Run /baton:run when ready.`,
          "info",
        );
      } catch (error) {
        if (error instanceof ActiveRunGuardError) {
          ctx.ui.notify(error.message, "warning");
          return;
        }
        if (error instanceof WorkflowValidationError) {
          ctx.ui.notify(`Workflow validation failed: ${error.message}`, "error");
          return;
        }
        if (error instanceof MissingAgentsError) {
          ctx.ui.notify(error.message, "error");
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to start Baton run: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("baton:run", {
    description: "Run the active idle Baton run to a terminal state",
    handler: async (_args, ctx) => {
      try {
        const manifest = await loadActiveRun(ctx.cwd);
        if (!manifest) {
          ctx.ui.notify(NO_ACTIVE_RUN_MESSAGE, "info");
          return;
        }

        if (manifest.state !== "idle" && manifest.state !== "running") {
          ctx.ui.notify(`Run ${manifest.id} is already terminal (${manifest.state}).`, "warning");
          return;
        }

        const workflow = await loadWorkflowById(ctx.cwd, manifest.workflowId);
        validateWorkflowAgents(ctx.cwd, workflow);

        const runUi = createRunUiController(ctx);

        try {
          const summary = await runContinuous({
            cwd: ctx.cwd,
            runId: manifest.id,
            stepRunner: createSubagentRunner(),
            sessionModel: ctx.model,
            onProgress: runUi.onProgress,
          });

          ctx.ui.notify(formatRunResultSummary(summary), summary.state === "completed" ? "info" : "error");
        } finally {
          runUi.clear();
        }
      } catch (error) {
        if (error instanceof WorkflowValidationError) {
          ctx.ui.notify(`Workflow validation failed: ${error.message}`, "error");
          return;
        }
        if (error instanceof MissingAgentsError) {
          ctx.ui.notify(error.message, "error");
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Baton run failed: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("baton:status", {
    description: "Show the active Baton run summary",
    handler: async (_args, ctx) => {
      const manifest = (await loadActiveRun(ctx.cwd)) ?? (await loadMostRecentTerminalRun(ctx.cwd));
      if (!manifest) {
        ctx.ui.notify(NO_ACTIVE_RUN_MESSAGE, "info");
        return;
      }

      ctx.ui.notify(formatStatusSummary(manifest), "info");
    },
  });
}
