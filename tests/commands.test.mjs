import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { default: registerBaton } = await import("../extensions/index.ts");
const { createIdleRun, loadActiveRun, updateRunState } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir, getRunsDir, getWorkflowsDir } = await import("../lib/paths.ts");
const { NO_ACTIVE_RUN_MESSAGE } = await import("../lib/status.ts");
const { parseWorkflowDocument } = await import("../lib/workflow-schema.ts");

function captureCommandHandlers() {
  const handlers = new Map();
  registerBaton({
    registerCommand(name, options) {
      handlers.set(name, options.handler);
    },
  });
  return handlers;
}

function createMockUi(options = {}) {
  let inputIndex = 0;
  const notifications = [];
  const identity = (value) => value;

  return {
    notifications,
    notify(message, level) {
      notifications.push({ message, level });
    },
    async input(_label, defaultValue) {
      if (options.inputs?.[inputIndex] === undefined) return defaultValue;
      return options.inputs[inputIndex++];
    },
    async select(_label, choices) {
      return choices[0];
    },
    async editor(_title, content) {
      return options.editorContent ?? content;
    },
    setWidget() {},
    setStatus() {},
    theme: {
      fg: (_tone, text) => text,
    },
  };
}

function createCtx(cwd, ui, overrides = {}) {
  const ctx = {
    cwd,
    hasUI: true,
    model: { provider: "anthropic", id: "test-model" },
    ...overrides,
  };
  if (ui !== undefined) {
    ctx.ui = ui;
  }
  return ctx;
}

const handlers = captureCommandHandlers();

test("baton:new creates derived scaffold with model placeholders", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-new-"));
  const ui = createMockUi({ inputs: ["Custom Review Loop"] });

  try {
    await handlers.get("baton:new")(undefined, createCtx(cwd, ui));

    const filePath = join(cwd, ".pi", "baton", "workflows", "custom-review-loop.yaml");
    await access(filePath);
    const content = await readFile(filePath, "utf8");
    const workflow = parseWorkflowDocument(content, { id: "custom-review-loop", source: "user", path: filePath });
    assert.equal(workflow.name, "Custom Review Loop");
    assert.match(content, /model: <your-fast-model>/);
    assert.match(content, /model: <your-strong-model>/);

    const created = ui.notifications.find((entry) => entry.level === "info");
    assert.ok(created?.message.includes("Created workflow scaffold"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:new re-prompts on filename collision", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-collision-"));

  try {
    await handlers.get("baton:new")(undefined, createCtx(cwd, createMockUi({ inputs: ["Custom Loop"] })));

    const retryUi = createMockUi({ inputs: ["Custom Loop", "Unique Loop"] });
    await handlers.get("baton:new")(undefined, createCtx(cwd, retryUi));

    const collision = retryUi.notifications.find((entry) =>
      entry.message.includes("Workflow filename already exists"),
    );
    assert.ok(collision);

    await access(join(cwd, ".pi", "baton", "workflows", "unique-loop.yaml"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:new rejects empty workflow names inline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-empty-name-"));
  const ui = createMockUi({ inputs: ["   ", "Valid Loop"] });

  try {
    await handlers.get("baton:new")(undefined, createCtx(cwd, ui));

    const warning = ui.notifications.find((entry) => entry.message === "Workflow name is required.");
    assert.ok(warning);
    await access(join(cwd, ".pi", "baton", "workflows", "valid-loop.yaml"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:new requires interactive UI", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-no-ui-"));

  try {
    await assert.rejects(
      () => handlers.get("baton:new")(undefined, createCtx(cwd, undefined, { hasUI: false })),
      TypeError,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start creates idle run from builtin default-review-loop", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-start-"));
  const ui = createMockUi({
    inputs: ["Ship command tests"],
  });

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    const created = ui.notifications.find((entry) => entry.message.includes("Idle run created"));
    assert.ok(created);

    const active = await loadActiveRun(cwd);
    assert.equal(active?.state, "idle");
    assert.equal(active?.workflowId, "default-review-loop");
    assert.equal(active?.taskBrief, "Ship command tests");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start selects the second of two local workflows with the same name", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-duplicate-name-"));
  const ui = createMockUi({ inputs: ["Use the second workflow"] });
  let labels;
  ui.select = async (_label, choices) => {
    labels = choices;
    return choices[1];
  };

  try {
    const workflowsDir = getWorkflowsDir(cwd);
    await mkdir(workflowsDir, { recursive: true });
    const yaml = `name: Shared Loop
iteration_cap: 2
steps:
  implement:
    agent: worker
    prompt: do work
    next: implement
`;
    const ids = ["local-alpha", "local-beta"];
    for (const id of ids) {
      await writeFile(join(workflowsDir, `${id}.yaml`), yaml, "utf8");
    }

    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    assert.ok(labels, JSON.stringify(ui.notifications));
    assert.notEqual(labels[0], labels[1]);
    const rowIds = labels.slice(0, 2).map((label) => {
      assert.match(label, /Shared Loop/);
      return ids.find((id) => label.includes(id));
    });
    assert.deepEqual([...rowIds].sort(), ids);
    assert.match(labels[2], /default-review-loop/);

    const active = await loadActiveRun(cwd);
    assert.equal(active?.state, "idle");
    assert.equal(active?.workflowId, rowIds[1]);
    assert.equal(active?.workflowPath, join(workflowsDir, `${rowIds[1]}.yaml`));
    assert.equal(active?.workflowSource, "user");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start keeps local precedence when selecting a builtin row with the same ID", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-shadowed-workflow-"));
  const ui = createMockUi({ inputs: ["Use the local override"] });
  let matchingLabels;
  ui.select = async (_label, choices) => {
    matchingLabels = choices.filter((label) => label.includes("default-review-loop"));
    return matchingLabels[1];
  };

  try {
    const workflowsDir = getWorkflowsDir(cwd);
    await mkdir(workflowsDir, { recursive: true });
    const localPath = join(workflowsDir, "default-review-loop.yaml");
    await writeFile(localPath, await readFile(join(getPackageWorkflowsDir(), "default-review-loop.yaml")));

    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    assert.equal(matchingLabels.length, 2);
    assert.notEqual(matchingLabels[0], matchingLabels[1]);
    const active = await loadActiveRun(cwd);
    assert.equal(active?.state, "idle");
    assert.equal(active?.workflowId, "default-review-loop");
    assert.equal(active?.workflowPath, localPath);
    assert.equal(active?.workflowSource, "user");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start cancels workflow selection without prompting for a brief or creating a run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-cancel-start-"));
  const ui = createMockUi();
  ui.select = async () => undefined;
  let prompted = false;
  ui.input = async () => {
    prompted = true;
    return "This should not create a run";
  };

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    assert.equal(prompted, false);
    assert.deepEqual(await readdir(getRunsDir(cwd)), []);
    assert.equal(await loadActiveRun(cwd), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start rejects empty task brief inline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-empty-brief-"));
  const ui = createMockUi({
    inputs: ["   "],
  });

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));
    const warning = ui.notifications.find((entry) => entry.message === "Task brief is required.");
    assert.ok(warning);

    const malformedCwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-malformed-workflow-"));
    const malformedUi = createMockUi();
    try {
      const workflowsDir = join(malformedCwd, ".pi", "baton", "workflows");
      await mkdir(workflowsDir, { recursive: true });
      await writeFile(join(workflowsDir, "broken.yaml"), "name: [", "utf8");

      await handlers.get("baton:start")(undefined, createCtx(malformedCwd, malformedUi));

      const error = malformedUi.notifications.find((entry) => entry.level === "error");
      assert.match(error?.message ?? "", /^Workflow validation failed: Invalid YAML:/);
    } finally {
      await rm(malformedCwd, { recursive: true, force: true });
    }

    const missingFieldCwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-missing-workflow-field-"));
    const missingFieldUi = createMockUi();
    try {
      const workflowsDir = join(missingFieldCwd, ".pi", "baton", "workflows");
      await mkdir(workflowsDir, { recursive: true });
      await writeFile(
        join(workflowsDir, "missing-cap.yaml"),
        `name: Missing Cap
steps:
  implement:
    agent: worker
    prompt: do work
    next: implement
`,
        "utf8",
      );

      await handlers.get("baton:start")(undefined, createCtx(missingFieldCwd, missingFieldUi));

      const error = missingFieldUi.notifications.find((entry) => entry.level === "error");
      assert.equal(error?.message, "Workflow validation failed: iteration_cap is required");
    } finally {
      await rm(missingFieldCwd, { recursive: true, force: true });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start blocks a second active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-guard-"));
  const ui = createMockUi({
    inputs: ["first run", "second run"],
  });

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    const guard = ui.notifications.find((entry) => entry.message.includes("Active run"));
    assert.match(guard?.message ?? "", /\/baton:status|\/baton:run/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:status reports active idle run summary", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-status-"));
  const ui = createMockUi();

  try {
    await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Status command test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 5,
    });

    await handlers.get("baton:status")(undefined, createCtx(cwd, ui));

    const summary = ui.notifications.find((entry) => entry.level === "info");
    assert.match(summary?.message ?? "", /workflow: Default Review Loop/);
    assert.match(summary?.message ?? "", /task brief: Status command test/);
    assert.match(summary?.message ?? "", /run state: idle/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:status falls back to terminal failed run with iteration-cap reason", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-status-failed-cap-"));
  const ui = createMockUi();

  try {
    const manifest = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "Status failed cap test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    await updateRunState(cwd, manifest.id, {
      state: "failed",
      currentStep: "review",
      lastStep: "fix",
      iteration: 2,
      failureReason: "Iteration cap (2) reached",
    });

    await handlers.get("baton:status")(undefined, createCtx(cwd, ui));

    const summary = ui.notifications.find((entry) => entry.level === "info");
    assert.match(summary?.message ?? "", /This Baton run has finished \(failed\)\./);
    assert.match(summary?.message ?? "", /failure: Iteration cap \(2\) reached/);
    assert.match(summary?.message ?? "", /task brief: Status failed cap test/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:status shows no-active-run message when pointer manifest is unreadable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-status-corrupt-"));
  const ui = createMockUi();
  const runId = "20260623000000-corrupt04";

  try {
    const runDir = join(cwd, ".pi", "baton", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "run.json"), "{not-json", "utf8");
    await writeFile(join(cwd, ".pi", "baton", "active-run.json"), `${JSON.stringify({ runId })}\n`, "utf8");

    await handlers.get("baton:status")(undefined, createCtx(cwd, ui));

    const message = ui.notifications.find((entry) => entry.message === NO_ACTIVE_RUN_MESSAGE);
    assert.ok(message);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:status shows no-active-run message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-status-empty-"));
  const ui = createMockUi();

  try {
    await handlers.get("baton:status")(undefined, createCtx(cwd, ui));
    const message = ui.notifications.find((entry) => entry.message === NO_ACTIVE_RUN_MESSAGE);
    assert.ok(message);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:run shows no-active-run message when idle run is missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-run-empty-"));
  const ui = createMockUi();

  try {
    await handlers.get("baton:run")(undefined, createCtx(cwd, ui));
    const message = ui.notifications.find((entry) => entry.message === NO_ACTIVE_RUN_MESSAGE);
    assert.ok(message);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
