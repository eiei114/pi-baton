import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { loadTerminalRunHistory, createIdleRun, updateRunState, TERMINAL_HISTORY_MAX_SCAN } =
  await import("../lib/run-store.ts");
const { formatHistorySummary, NO_TERMINAL_HISTORY_MESSAGE } = await import("../lib/status.ts");
const { getPackageWorkflowsDir, getRunManifestPath } = await import("../lib/paths.ts");
const { default: registerBaton } = await import("../extensions/index.ts");

function baseManifest(overrides = {}) {
  return {
    id: "20260620000000-abcd1234",
    state: "completed",
    workflowId: "default-review-loop",
    workflowName: "Default Review Loop",
    workflowPath: "ignored",
    workflowSource: "builtin",
    taskBrief: "History test",
    targetDirectory: "/tmp",
    entryStep: "implement",
    currentStep: null,
    lastStep: "review",
    iteration: 2,
    iterationCap: 2,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

async function writeManifest(cwd, manifest) {
  const runDir = join(cwd, ".pi", "baton", "runs", manifest.id);
  await mkdir(runDir, { recursive: true });
  await writeFile(getRunManifestPath(cwd, manifest.id), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("formatHistorySummary shows empty-state guidance", () => {
  const summary = formatHistorySummary({ runs: [], skippedCount: 0 });
  assert.equal(summary, NO_TERMINAL_HISTORY_MESSAGE);
  assert.match(summary, /\/baton:start/);
  assert.match(summary, /\/baton:run/);
});

test("loadTerminalRunHistory returns empty history when no terminal runs exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-empty-"));

  try {
    const history = await loadTerminalRunHistory(cwd);
    assert.deepEqual(history.runs, []);
    assert.equal(history.skippedCount, 0);
    assert.equal(formatHistorySummary(history), NO_TERMINAL_HISTORY_MESSAGE);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadTerminalRunHistory lists a single completed run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-single-"));

  try {
    await writeManifest(cwd, baseManifest());

    const history = await loadTerminalRunHistory(cwd);
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].id, "20260620000000-abcd1234");
    assert.equal(history.runs[0].state, "completed");

    const summary = formatHistorySummary(history);
    assert.match(summary, /completed \| 20260620000000-abcd1234/);
    assert.match(summary, /Default Review Loop/);
    assert.match(summary, /last: review/);
    assert.match(summary, /iter: 2/);
    assert.match(summary, /updated: 2026-06-20T00:00:00.000Z/);
    assert.match(summary, /\.pi\/baton\/runs\/20260620000000-abcd1234/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadTerminalRunHistory sorts multiple terminal runs newest first", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-multi-"));

  try {
    await writeManifest(
      cwd,
      baseManifest({
        id: "20260618000000-older0001",
        updatedAt: "2026-06-18T12:00:00.000Z",
        createdAt: "2026-06-18T10:00:00.000Z",
        state: "failed",
        lastStep: "implement",
        iteration: 1,
      }),
    );
    await writeManifest(
      cwd,
      baseManifest({
        id: "20260620000000-newer0002",
        updatedAt: "2026-06-20T12:00:00.000Z",
        createdAt: "2026-06-20T10:00:00.000Z",
        state: "completed",
        lastStep: "review",
        iteration: 2,
      }),
    );

    const history = await loadTerminalRunHistory(cwd);
    assert.equal(history.runs.length, 2);
    assert.equal(history.runs[0].id, "20260620000000-newer0002");
    assert.equal(history.runs[1].id, "20260618000000-older0001");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadTerminalRunHistory keeps the newest run when the scan cap is exceeded", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-scan-cap-"));

  try {
    const runsDir = join(cwd, ".pi", "baton", "runs");
    await mkdir(runsDir, { recursive: true });

    for (let index = 0; index < TERMINAL_HISTORY_MAX_SCAN; index += 1) {
      const suffix = String(index).padStart(4, "0");
      await mkdir(join(runsDir, `20200101000000-pad${suffix}`), { recursive: true });
    }

    await writeManifest(
      cwd,
      baseManifest({
        id: "20260901000000-newest01",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      }),
    );

    const history = await loadTerminalRunHistory(cwd);
    assert.deepEqual(
      history.runs.map((run) => run.id),
      ["20260901000000-newest01"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadTerminalRunHistory excludes idle and running runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-nonterminal-"));

  try {
    await writeManifest(
      cwd,
      baseManifest({
        id: "20260621000000-idle00001",
        state: "idle",
        currentStep: "implement",
        lastStep: null,
        iteration: 0,
      }),
    );
    await writeManifest(
      cwd,
      baseManifest({
        id: "20260621000000-run000002",
        state: "running",
        currentStep: "review",
        lastStep: "implement",
        iteration: 1,
      }),
    );
    await writeManifest(
      cwd,
      baseManifest({
        id: "20260621000000-done00003",
        state: "completed",
        updatedAt: "2026-06-21T12:00:00.000Z",
      }),
    );

    const history = await loadTerminalRunHistory(cwd);
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].id, "20260621000000-done00003");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadTerminalRunHistory skips corrupt manifests with bounded diagnostics", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-skips-"));

  try {
    const corruptDir = join(cwd, ".pi", "baton", "runs", "20260622000000-corrupt01");
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, "run.json"), "{not-json", "utf8");

    const incompleteDir = join(cwd, ".pi", "baton", "runs", "20260622000000-incomplete");
    await mkdir(incompleteDir, { recursive: true });
    await writeFile(
      join(incompleteDir, "run.json"),
      `${JSON.stringify({ id: "20260622000000-incomplete", state: "completed" })}\n`,
      "utf8",
    );

    await writeManifest(
      cwd,
      baseManifest({
        id: "20260622000000-valid0001",
        updatedAt: "2026-06-22T12:00:00.000Z",
      }),
    );

    const history = await loadTerminalRunHistory(cwd);
    assert.equal(history.runs.length, 1);
    assert.equal(history.skippedCount, 2);

    const summary = formatHistorySummary(history);
    assert.match(summary, /\(2 run\(s\) skipped: unreadable or incomplete manifest\)/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("baton:history command notifies formatted terminal run history", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-history-cmd-"));
  const notifications = [];
  let handler;

  registerBaton({
    registerCommand(name, options) {
      if (name === "baton:history") {
        handler = options.handler;
      }
    },
  });

  try {
    const created = await createIdleRun(cwd, {
      workflowId: "default-review-loop",
      workflowName: "Default Review Loop",
      workflowPath: join(getPackageWorkflowsDir(), "default-review-loop.yaml"),
      workflowSource: "builtin",
      taskBrief: "History command test",
      targetDirectory: cwd,
      entryStep: "implement",
      iterationCap: 2,
    });

    await updateRunState(cwd, created.id, {
      state: "completed",
      currentStep: null,
      lastStep: "review",
      iteration: 2,
    });

    await handler(undefined, {
      cwd,
      ui: {
        notify(message, level) {
          notifications.push({ message, level });
        },
      },
    });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "info");
    assert.match(notifications[0].message, new RegExp(`completed \\| ${created.id}`));
    assert.match(notifications[0].message, /Default Review Loop/);
    assert.match(notifications[0].message, /\.pi\/baton\/runs\//);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
