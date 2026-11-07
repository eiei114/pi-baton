import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

const { default: registerBaton } = await import("../extensions/index.ts");
const {
  INSPECTION_MAX_OUTPUT_CODE_POINTS,
  INSPECTION_MAX_STEP_FILES,
  INSPECTION_MAX_STEP_FILE_BYTES,
  INSPECTION_MAX_TEXT_CODE_POINTS,
  formatRunInspection,
  inspectSelectedRun,
} = await import("../lib/run-inspection.ts");
const { getRunManifestPath, getRunOutputsDir, getRunStepsDir } = await import("../lib/paths.ts");

const handlers = new Map();
registerBaton({
  registerCommand(name, options) {
    handlers.set(name, options.handler);
  },
});

function baseManifest(id = "20261012000000-run00001", overrides = {}) {
  return {
    id,
    state: "completed",
    workflowId: "default-review-loop",
    workflowName: "Default Review Loop",
    workflowPath: "ignored",
    workflowSource: "builtin",
    taskBrief: "Sensitive task brief must not be displayed",
    targetDirectory: "/sensitive/project/path",
    entryStep: "implement",
    currentStep: null,
    lastStep: "review",
    iteration: 2,
    iterationCap: 2,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

function stepRecord(overrides = {}) {
  return {
    stepName: "implement",
    iteration: 1,
    agent: "worker",
    startedAt: "2026-10-12T00:00:01.000Z",
    finishedAt: "2026-10-12T00:00:02.000Z",
    envelope: {
      summary: "implemented change",
      rawOutputPath: ".pi/baton/runs/raw/outputs/secret.txt",
    },
    exitCode: 0,
    ...overrides,
  };
}

async function assertMissingRunStorage(cwd) {
  await assert.rejects(
    access(join(cwd, ".pi", "baton", "runs"), fsConstants.F_OK),
    (error) => error && "code" in error && error.code === "ENOENT",
  );
}

async function writeRun(cwd, manifest, records = {}) {
  const runDir = join(cwd, ".pi", "baton", "runs", manifest.id);
  const stepsDir = getRunStepsDir(cwd, manifest.id);
  await mkdir(stepsDir, { recursive: true });
  await writeFile(getRunManifestPath(cwd, manifest.id), `${JSON.stringify(manifest)}\n`, "utf8");
  for (const [filename, record] of Object.entries(records)) {
    await writeFile(join(stepsDir, filename), `${JSON.stringify(record)}\n`, "utf8");
  }
  return runDir;
}

function trackedFileSystem({ failReadFile, failOpen } = {}) {
  const paths = { readFile: [], readdir: [], lstat: [], open: [] };
  return {
    paths,
    async readFile(filePath) {
      paths.readFile.push(filePath);
      if (failReadFile?.(filePath)) throw new Error("unreadable");
      return readFile(filePath);
    },
    async readdir(directoryPath) {
      paths.readdir.push(directoryPath);
      return readdir(directoryPath, { withFileTypes: true });
    },
    async lstat(filePath) {
      paths.lstat.push(filePath);
      const { lstat } = await import("node:fs/promises");
      return lstat(filePath);
    },
    async open(filePath) {
      paths.open.push(filePath);
      if (failOpen?.(filePath)) throw new Error("unreadable");
      const flags =
        typeof fsConstants.O_NOFOLLOW === "number"
          ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
          : fsConstants.O_RDONLY;
      return open(filePath, flags);
    },
  };
}

function mockUi({ selected, cancel = false, onSelect } = {}) {
  const notifications = [];
  let choicesSeen;
  return {
    notifications,
    get choicesSeen() {
      return choicesSeen;
    },
    async select(_label, choices) {
      choicesSeen = choices;
      const choiceOverride = await onSelect?.(choices);
      return cancel ? undefined : choiceOverride ?? selected ?? choices[0];
    },
    notify(message, level) {
      notifications.push({ message, level });
    },
  };
}

function context(cwd, ui, overrides = {}) {
  return { cwd, hasUI: true, ui, ...overrides };
}

test("/baton:inspect is interactive-only, limits chooser to 10 terminal runs, and cancellation is read-only", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-chooser-"));
  const activePointer = join(cwd, ".pi", "baton", "active-run.json");

  try {
    for (let index = 0; index < 12; index++) {
      const id = `20261012${String(index).padStart(6, "0")}-run${String(index).padStart(5, "0")}`;
      await writeRun(
        cwd,
        baseManifest(id, {
          state: index % 2 === 0 ? "completed" : "failed",
          workflowName: `Workflow ${index}`,
          updatedAt: `2026-10-12T00:${String(index).padStart(2, "0")}:00.000Z`,
        }),
        { "one.json": stepRecord({ envelope: { summary: "keep unchanged", rawOutputPath: "secret" } }) },
      );
    }
    await writeRun(cwd, baseManifest("20261013000000-running", { state: "running" }));
    await writeRun(cwd, baseManifest("20261014000000-idle", { state: "idle" }));
    await writeFile(activePointer, '{"runId":"active-sentinel"}\n', "utf8");

    const beforeManifest = await readFile(getRunManifestPath(cwd, "20261012000000-run00000"));
    const beforeStep = await readFile(join(getRunStepsDir(cwd, "20261012000000-run00000"), "one.json"));
    const ui = mockUi({ cancel: true });
    await handlers.get("baton:inspect")(undefined, context(cwd, ui));

    assert.equal(ui.choicesSeen.length, 10);
    assert.match(ui.choicesSeen[0], /failed \| Workflow 11 \| updated: .*run: 20261012000011-run00011/);
    assert.match(ui.choicesSeen[1], /completed \| Workflow 10 \| updated: .*run: 20261012000010-run00010/);
    assert.ok(ui.choicesSeen.every((choice) => !choice.includes("running") && !choice.includes("idle")));
    assert.equal(ui.notifications.length, 0);
    assert.deepEqual(await readFile(activePointer), Buffer.from('{"runId":"active-sentinel"}\n'));
    assert.deepEqual(await readFile(getRunManifestPath(cwd, "20261012000000-run00000")), beforeManifest);
    assert.deepEqual(
      await readFile(join(getRunStepsDir(cwd, "20261012000000-run00000"), "one.json")),
      beforeStep,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/baton:inspect chooser cancellation creates no run storage when none exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-empty-cancel-"));
  const ui = mockUi();

  try {
    await handlers.get("baton:inspect")(undefined, context(cwd, ui));
    assert.equal(ui.choicesSeen, undefined);
    assert.equal(ui.notifications.length, 1);
    assert.match(ui.notifications[0].message, /No completed or failed Baton runs/);
    await assertMissingRunStorage(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/baton:inspect follows the UI guard", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-no-ui-"));
  const notifications = [];

  try {
    await handlers.get("baton:inspect")(undefined, context(cwd, { notify: (message, level) => notifications.push({ message, level }) }, { hasUI: false }));
    assert.deepEqual(notifications, [
      { message: "Pi Baton commands require interactive UI.", level: "warning" },
    ]);
    await assertMissingRunStorage(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("inspection rejects symlinked steps directories and step entries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-symlink-"));
  const id = "20261012000000-symlink-steps";

  try {
    await writeRun(cwd, baseManifest(id));
    const symlinkSteps = {
      async readFile(filePath) {
        return readFile(filePath);
      },
      async readdir() {
        return [];
      },
      async lstat(filePath) {
        if (filePath.endsWith("steps")) {
          return { isSymbolicLink: () => true, isFile: () => false };
        }
        const { lstat } = await import("node:fs/promises");
        return lstat(filePath);
      },
      async open() {
        throw new Error("should not open step files for a symlinked steps directory");
      },
    };
    const blocked = await inspectSelectedRun(cwd, id, symlinkSteps);
    assert.equal(blocked.status, "ready");
    assert.equal(blocked.inspection.stepsUnavailable, true);

    await writeRun(cwd, baseManifest("20261012000000-symlink-entry"), {
      "good.json": stepRecord({ envelope: { summary: "kept", rawOutputPath: "" } }),
    });
    const entrySteps = {
      async readFile(filePath) {
        return readFile(filePath);
      },
      async readdir(directoryPath) {
        return [
          { name: "good.json", isFile: () => true, isSymbolicLink: () => false },
          { name: "linked.json", isFile: () => false, isSymbolicLink: () => true },
        ];
      },
      async lstat(filePath) {
        const { lstat } = await import("node:fs/promises");
        return lstat(filePath);
      },
      async open(filePath) {
        const flags =
          typeof fsConstants.O_NOFOLLOW === "number"
            ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
            : fsConstants.O_RDONLY;
        return open(filePath, flags);
      },
    };
    const filtered = await inspectSelectedRun(cwd, "20261012000000-symlink-entry", entrySteps);
    assert.equal(filtered.status, "ready");
    assert.equal(filtered.inspection.records.length, 1);
    assert.equal(filtered.inspection.records[0].summary, "kept");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("inspection rechecks the exact selected manifest and fails closed when it changed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-stale-"));
  const selectedId = "20261012000000-selected";
  const otherId = "20261012000001-other";

  try {
    await writeRun(cwd, baseManifest(selectedId, { state: "completed" }), {
      "one.json": stepRecord({ envelope: { summary: "must not inspect", rawOutputPath: "" } }),
    });
    await writeRun(cwd, baseManifest(otherId), {
      "one.json": stepRecord({ envelope: { summary: "must not fall back", rawOutputPath: "" } }),
    });

    const ui = mockUi({
      selected: undefined,
      onSelect: async (choices) => {
        await writeFile(
          getRunManifestPath(cwd, selectedId),
          `${JSON.stringify(baseManifest(selectedId, { state: "running" }))}\n`,
          "utf8",
        );
        return choices.find((choice) => choice.includes(`run: ${selectedId}`));
      },
    });
    await handlers.get("baton:inspect")(undefined, context(cwd, ui));

    assert.equal(ui.notifications.length, 1);
    assert.equal(ui.notifications[0].level, "warning");
    assert.match(ui.notifications[0].message, /selected run is unavailable or is no longer terminal/);
    assert.doesNotMatch(ui.notifications[0].message, /must not/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("inspection reads only the selected manifest and its steps, never outputs or manifest details", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-paths-"));
  const selectedId = "20261012000000-selected";
  const otherId = "20261012000001-other";
  const rawOutput = join(getRunOutputsDir(cwd, selectedId), "secret.txt");

  try {
    await writeRun(cwd, baseManifest(selectedId), {
      "one.json": stepRecord(),
    });
    await writeRun(cwd, baseManifest(otherId), { "other.json": stepRecord() });
    await mkdir(getRunOutputsDir(cwd, selectedId), { recursive: true });
    await writeFile(rawOutput, "RAW OUTPUT SECRET", "utf8");

    const fs = trackedFileSystem();
    const result = await inspectSelectedRun(cwd, selectedId, fs);
    assert.equal(result.status, "ready");
    const message = formatRunInspection(result.inspection);

    assert.deepEqual(fs.paths.readFile, [getRunManifestPath(cwd, selectedId)]);
    assert.deepEqual(fs.paths.readdir, [getRunStepsDir(cwd, selectedId)]);
    assert.deepEqual(fs.paths.open, [join(getRunStepsDir(cwd, selectedId), "one.json")]);
    assert.ok(fs.paths.lstat.every((path) => path.startsWith(getRunStepsDir(cwd, selectedId))));
    assert.ok(![...fs.paths.readFile, ...fs.paths.readdir, ...fs.paths.lstat, ...fs.paths.open].includes(rawOutput));
    assert.doesNotMatch(message, /Sensitive task brief|sensitive\/project|RAW OUTPUT SECRET|rawOutputPath|secret\.txt/);
    assert.match(message, /implemented change/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("stale, unreadable, and nonterminal manifests never inspect a steps directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-revalidation-"));

  try {
    const missing = await inspectSelectedRun(cwd, "20261012000000-missing", trackedFileSystem());
    assert.deepEqual(missing, { status: "stale" });

    const id = "20261012000000-recheck";
    await writeRun(cwd, baseManifest(id, { state: "running" }));
    const changed = trackedFileSystem();
    assert.deepEqual(await inspectSelectedRun(cwd, id, changed), { status: "stale" });
    assert.deepEqual(changed.paths.readdir, []);
    assert.deepEqual(changed.paths.open, []);

    const unreadable = trackedFileSystem({ failReadFile: () => true });
    assert.deepEqual(await inspectSelectedRun(cwd, id, unreadable), { status: "stale" });
    assert.deepEqual(unreadable.paths.readdir, []);
    assert.deepEqual(unreadable.paths.open, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("step records sort by timestamp then iteration and filename, with optional review fields", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-order-"));
  const id = "20261012000000-ordering";

  try {
    await writeRun(cwd, baseManifest(id), {
      "z-first-by-name.json": stepRecord({
        stepName: "z-name",
        iteration: 1,
        startedAt: "2026-10-12T00:00:01.000Z",
        envelope: { summary: "timestamp tie, later iteration", rawOutputPath: "" },
      }),
      "b-first-by-iteration.json": stepRecord({
        stepName: "review-reject",
        iteration: 0,
        startedAt: "2026-10-12T00:00:01.000Z",
        envelope: {
          summary: "review summary",
          rawOutputPath: "ignored",
          judgment: "reject",
          findings: ["finding A", "finding B"],
        },
      }),
      "a-accept.json": stepRecord({
        stepName: "review-accept",
        iteration: 1,
        startedAt: "2026-10-12T00:00:03.000Z",
        envelope: {
          summary: "accepted summary",
          rawOutputPath: "ignored",
          judgment: "accept",
          acceptanceNote: "review passed",
        },
      }),
      "c-no-optional-review.json": stepRecord({
        stepName: "plain step",
        iteration: 1,
        startedAt: "2026-10-12T00:00:03.000Z",
        envelope: { summary: "optional fields absent", rawOutputPath: "ignored" },
      }),
    });

    const result = await inspectSelectedRun(cwd, id);
    assert.equal(result.status, "ready");
    const message = formatRunInspection(result.inspection);
    const labels = ["review-reject", "z-name", "review-accept", "plain step"];
    const positions = labels.map((label) => message.indexOf(`step: ${label}`));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.match(message, /review: reject[\s\S]*finding: finding A[\s\S]*finding: finding B/);
    assert.match(message, /review: accept[\s\S]*acceptance note: review passed/);
    const optionalRecord = message.slice(message.indexOf("step: plain step"));
    assert.doesNotMatch(optionalRecord, /review:|finding:|acceptance note:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("inspection sorts filenames before the 100-file limit and reports skipped and omitted counts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-file-cap-"));
  const id = "20261012000000-many-files";
  const records = {};

  try {
    for (let index = 0; index <= INSPECTION_MAX_STEP_FILES; index++) {
      records[`${String(index).padStart(3, "0")}.json`] = stepRecord({
        stepName: `step-${index}`,
        iteration: index,
        startedAt: `2026-10-12T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        envelope: { summary: `summary-${index}`, rawOutputPath: "ignored" },
      });
    }
    await writeRun(cwd, baseManifest(id), records);

    const fs = trackedFileSystem();
    const result = await inspectSelectedRun(cwd, id, fs);
    assert.equal(result.status, "ready");
    assert.equal(result.inspection.records.length, 50);
    assert.equal(result.inspection.omittedRecordCount, 50);
    assert.equal(result.inspection.uninspectedFileCount, 1);
    assert.equal(fs.paths.open.length, INSPECTION_MAX_STEP_FILES);
    assert.ok(fs.paths.open.every((path) => !path.endsWith("100.json")));
    assert.equal(result.inspection.records[0].filename, "000.json");
    const output = formatRunInspection(result.inspection);
    assert.match(output, /uninspected files=1; records omitted=50/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("oversized, unreadable, and malformed records are skipped without hiding valid records", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-damaged-"));
  const id = "20261012000000-damaged";

  try {
    await writeRun(cwd, baseManifest(id), {
      "01-good.json": stepRecord({ envelope: { summary: "surviving record", rawOutputPath: "" } }),
      "02-large.json": "x".repeat(INSPECTION_MAX_STEP_FILE_BYTES + 1),
      "03-malformed.json": "{not-json",
      "04-unreadable.json": stepRecord(),
    });
    const unreadablePath = join(getRunStepsDir(cwd, id), "04-unreadable.json");
    const fs = trackedFileSystem({ failOpen: (path) => path === unreadablePath });

    const result = await inspectSelectedRun(cwd, id, fs);
    assert.equal(result.status, "ready");
    assert.equal(result.inspection.records.length, 1);
    assert.equal(result.inspection.records[0].summary, "surviving record");
    assert.equal(result.inspection.skippedFileCount, 3);
    assert.ok(!fs.paths.open.includes(join(getRunStepsDir(cwd, id), "02-large.json")));
    assert.match(formatRunInspection(result.inspection), /skipped files=3/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("missing step directories and empty or all-malformed data produce recovery messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-baton-inspect-empty-"));
  const missingId = "20261012000000-no-steps";

  try {
    await mkdir(join(cwd, ".pi", "baton", "runs", missingId), { recursive: true });
    await writeFile(getRunManifestPath(cwd, missingId), `${JSON.stringify(baseManifest(missingId))}\n`);
    const missing = await inspectSelectedRun(cwd, missingId);
    assert.equal(missing.status, "ready");
    assert.match(formatRunInspection(missing.inspection), /Step records are unavailable/);

    const emptyId = "20261012000000-empty-steps";
    await writeRun(cwd, baseManifest(emptyId), { "broken.json": "[]" });
    const empty = await inspectSelectedRun(cwd, emptyId);
    assert.equal(empty.status, "ready");
    assert.match(formatRunInspection(empty.inspection), /No valid structured step summaries/);
    assert.match(formatRunInspection(empty.inspection), /skipped files=1/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("text normalization uses Unicode code points and output, finding, and text limits are enforced", () => {
  const records = Array.from({ length: 50 }, (_, index) => ({
    filename: `${index}.json`,
    stepName: `step-${index}\nsecond line`,
    iteration: index,
    summary: `${"😀".repeat(300)}\nline\u0000end`,
    judgment: "reject",
    findings: Array.from({ length: 8 }, (_, finding) => `${"界".repeat(300)}\nissue-${finding}`),
  }));
  const output = formatRunInspection({
    runId: "20261012000000-capped",
    records,
    skippedFileCount: 2,
    uninspectedFileCount: 10,
    omittedRecordCount: 5,
    stepsUnavailable: false,
  });

  assert.ok(Array.from(output).length <= INSPECTION_MAX_OUTPUT_CODE_POINTS);
  assert.match(output, /skipped files=2; uninspected files=10/);
  assert.match(output, /findings omitted=/);
  assert.match(output, /text items shortened=/);
  assert.match(output, /records omitted=/);
  assert.match(output, /step-0 second line\n  summary:/);
  assert.doesNotMatch(output, /\u0000/);
  const firstSummary = output.split("\n").find((line) => line.includes("summary:"));
  assert.ok(firstSummary);
  assert.ok(Array.from(firstSummary.slice(firstSummary.indexOf("summary:") + "summary:".length).trim()).length <= INSPECTION_MAX_TEXT_CODE_POINTS);
  const firstFinding = output.split("\n").find((line) => line.includes("finding:"));
  assert.ok(firstFinding);
  assert.ok(Array.from(firstFinding.slice(firstFinding.indexOf("finding:") + "finding:".length).trim()).length <= INSPECTION_MAX_TEXT_CODE_POINTS);
});

test("the output budget is charged incrementally per record block", () => {
  // Equivalence guard for the incremental running total: output stays under the cap and the
  // omitted-record count stays exact at the boundary. Paired with the scaling test below,
  // which is the one that fails when the running total is recomputed from the whole buffer.
  const summary = "s".repeat(INSPECTION_MAX_TEXT_CODE_POINTS);
  const recordFor = (index) => ({
    filename: `${index}.json`,
    stepName: "implement",
    iteration: index,
    summary,
  });
  const build = (count) => ({
    runId: "20261012000000-budget",
    records: Array.from({ length: count }, (_, index) => recordFor(index)),
    skippedFileCount: 0,
    uninspectedFileCount: 0,
    omittedRecordCount: 0,
    stepsUnavailable: false,
  });

  // Derive the per-record block cost from two populated renderings so the empty-records
  // recovery message cannot distort the arithmetic.
  const lengthFor = (count) => Array.from(formatRunInspection(build(count))).length;
  const perRecordLength = lengthFor(2) - lengthFor(1);
  assert.ok(perRecordLength > 0);
  const fits = Math.floor(INSPECTION_MAX_OUTPUT_CODE_POINTS / perRecordLength);

  const fullOutput = formatRunInspection(build(fits));
  assert.equal(Array.from(fullOutput).length <= INSPECTION_MAX_OUTPUT_CODE_POINTS, true);
  const keptFull = fullOutput.match(/step: implement/g)?.length ?? 0;
  assert.ok(keptFull > 1, "several records must survive at the derived boundary");
  assert.match(fullOutput, new RegExp(`records omitted=${fits - keptFull}`));

  const overflowOutput = formatRunInspection(build(fits + 20));
  const kept = overflowOutput.match(/step: implement/g)?.length ?? 0;
  assert.ok(kept > 0, "at least one record must survive");
  assert.ok(kept < fits + 20, "the overflowing records must be omitted");
  assert.match(overflowOutput, new RegExp(`records omitted=${fits + 20 - kept}`));
  assert.ok(Array.from(overflowOutput).length <= INSPECTION_MAX_OUTPUT_CODE_POINTS);
});

test("formatting cost stays near-linear in record count", () => {
  // Guards the quadratic regression this change removed: the previous implementation
  // re-joined the accumulated output and rebuilt a code-point array for every record.
  // A near-linear implementation lands around 4-6x for a 5x record increase; the
  // quadratic path measured 15-20x. The threshold sits between the two with margin.
  const build = (count) => ({
    runId: "20261012000000-scaling",
    records: Array.from({ length: count }, (_, index) => ({
      filename: `${index}.json`,
      stepName: `step-${index}`,
      iteration: index,
      summary: "s".repeat(60),
    })),
    skippedFileCount: 0,
    uninspectedFileCount: 0,
    omittedRecordCount: 0,
    stepsUnavailable: false,
  });

  const measure = (inspection, iterations) => {
    const start = performance.now();
    let sink = 0;
    for (let index = 0; index < iterations; index++) {
      sink += formatRunInspection(inspection).length;
    }
    if (sink < 0) throw new Error("unreachable");
    return performance.now() - start;
  };

  const small = build(10);
  const large = build(50);
  // Warm up so the ratio is not dominated by first-call JIT work.
  measure(small, 50);
  measure(large, 50);

  const ratios = [];
  for (let round = 0; round < 5; round++) {
    const smallMs = measure(small, 400);
    const largeMs = measure(large, 400);
    ratios.push(largeMs / smallMs);
  }
  ratios.sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)];

  assert.ok(
    medianRatio < 10,
    `formatting 5x the records took ${medianRatio.toFixed(2)}x the time; near-linear is ~5x and the removed quadratic path was ~15-20x`,
  );
});

test("code-point counting never splits a surrogate pair at the text cap", () => {
  const emoji = "\uD83D\uDE00";
  // 241 code points of astral text must truncate to exactly 240 whole code points.
  const output = formatRunInspection({
    runId: "20261012000000-astral",
    records: [
      {
        filename: "0.json",
        stepName: "implement",
        iteration: 0,
        summary: emoji.repeat(INSPECTION_MAX_TEXT_CODE_POINTS + 1),
      },
    ],
    skippedFileCount: 0,
    uninspectedFileCount: 0,
    omittedRecordCount: 0,
    stepsUnavailable: false,
  });

  const summaryLine = output.split("\n").find((line) => line.includes("summary:"));
  assert.ok(summaryLine);
  const body = summaryLine.slice(summaryLine.indexOf("summary:") + "summary:".length).trim();
  assert.equal(Array.from(body).length, INSPECTION_MAX_TEXT_CODE_POINTS);
  assert.equal(body, emoji.repeat(INSPECTION_MAX_TEXT_CODE_POINTS));
  // A split pair would leave a lone surrogate, which is not valid well-formed Unicode.
  assert.doesNotMatch(body, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
});
