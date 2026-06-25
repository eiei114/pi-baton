import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { default: registerBaton } = await import("../extensions/index.ts");
const { createIdleRun, loadActiveRun } = await import("../lib/run-store.ts");
const { getPackageWorkflowsDir } = await import("../lib/paths.ts");
const { NO_ACTIVE_RUN_MESSAGE } = await import("../lib/status.ts");

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
  let selectIndex = 0;
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
      if (options.selects?.[selectIndex] === undefined) return choices[0];
      return options.selects[selectIndex++];
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
    assert.match(content, /^name: Custom Review Loop/m);
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
    selects: ["Default Review Loop"],
    inputs: ["Ship command tests"],
  });

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));

    const created = ui.notifications.find((entry) => entry.message.includes("Idle run created"));
    assert.ok(created);

    const active = await loadActiveRun(cwd);
    assert.equal(active?.state, "idle");
    assert.equal(active?.taskBrief, "Ship command tests");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start rejects empty task brief inline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-empty-brief-"));
  const ui = createMockUi({
    selects: ["Default Review Loop"],
    inputs: ["   "],
  });

  try {
    await handlers.get("baton:start")(undefined, createCtx(cwd, ui));
    const warning = ui.notifications.find((entry) => entry.message === "Task brief is required.");
    assert.ok(warning);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:start blocks a second active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-cmd-guard-"));
  const ui = createMockUi({
    selects: ["Default Review Loop", "Default Review Loop"],
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
