import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  buildRunStatusText,
  buildRunStepChecklist,
  buildRunWidgetLines,
  type RunProgressUpdate,
} from "./run-widget.ts";

export interface RunUiController {
  onProgress: (update: RunProgressUpdate) => void;
  clear: () => void;
}

export function createRunUiController(ctx: ExtensionCommandContext): RunUiController {
  const render = (update: RunProgressUpdate) => {
    if (!ctx.hasUI) return;

    const lines = [
      ...buildRunWidgetLines(update).map((line, index) => {
        if (index === 0) return ctx.ui.theme.fg("accent", line);
        if (line.startsWith("status:")) return ctx.ui.theme.fg("warning", line);
        if (line.startsWith("judgment: accept")) return ctx.ui.theme.fg("success", line);
        if (line.startsWith("judgment: reject")) return ctx.ui.theme.fg("error", line);
        if (line.startsWith("failure:")) return ctx.ui.theme.fg("error", line);
        return ctx.ui.theme.fg("dim", line);
      }),
      "",
      ...buildRunStepChecklist(update.workflow, update).map((line) => {
        if (line.startsWith(">")) return ctx.ui.theme.fg("warning", line);
        if (line.startsWith("✓")) return ctx.ui.theme.fg("success", line);
        return ctx.ui.theme.fg("dim", line);
      }),
    ];

    ctx.ui.setWidget("baton-run", lines, { placement: "aboveEditor" });

    const status = buildRunStatusText(update);
    if (status) {
      ctx.ui.setStatus("baton", ctx.ui.theme.fg("accent", status));
    }
  };

  return {
    onProgress: render,
    clear: () => {
      if (!ctx.hasUI) return;
      ctx.ui.setWidget("baton-run", undefined);
      ctx.ui.setStatus("baton", undefined);
    },
  };
}
