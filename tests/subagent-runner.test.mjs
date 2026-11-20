import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";

const { createSubagentRunner } = await import("../lib/subagent-runner.ts");

const AGENT = "worker";

class FakeProcess extends EventEmitter {
  constructor(onKill) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
    this.signals = [];
    this.onKill = onKill;
  }

  kill(signal = "SIGTERM") {
    this.signals.push(signal);
    // Mirror Node: `killed` becomes true once a signal is delivered,
    // regardless of whether the process actually exited.
    this.killed = true;
    this.onKill?.(this, signal);
    return true;
  }

  finish(code, signal = null) {
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

function fakeSpawner(onKill) {
  let resolveSpawned;
  const spawned = new Promise((resolve) => {
    resolveSpawned = resolve;
  });
  const spawnProcess = () => {
    const proc = new FakeProcess(onKill);
    resolveSpawned(proc);
    return proc;
  };
  return { spawnProcess, spawned };
}

function settleWithin(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function countActiveTimeouts() {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("abort propagates SIGTERM to a real subagent process", async () => {
  const controller = new AbortController();
  let child;
  const signals = [];
  const runner = createSubagentRunner({
    killGraceMs: 10_000,
    spawnProcess: (_command, _args, options) => {
      child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
      const kill = child.kill.bind(child);
      child.kill = (signal) => {
        signals.push(signal);
        return kill(signal);
      };
      return child;
    },
  });

  const run = runner({ agent: AGENT, prompt: "hello", cwd: process.cwd(), signal: controller.signal });
  while (!child) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(child.pid, "child process should have spawned");
  assert.equal(isAlive(child.pid), true);

  controller.abort();
  await settleWithin(run, 5_000, "runner");

  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(isAlive(child.pid), false);
});

test("an already-aborted signal terminates the subagent immediately", async () => {
  const controller = new AbortController();
  controller.abort();
  const { spawnProcess, spawned } = fakeSpawner((proc, signal) => {
    if (signal === "SIGTERM") setImmediate(() => proc.finish(null, "SIGTERM"));
  });
  const runner = createSubagentRunner({ spawnProcess, killGraceMs: 60_000 });

  const run = runner({ agent: AGENT, prompt: "hello", cwd: process.cwd(), signal: controller.signal });
  const proc = await spawned;
  await settleWithin(run, 2_000, "runner");

  assert.deepEqual(proc.signals, ["SIGTERM"]);
});

test("SIGKILL fallback fires when the subagent ignores SIGTERM even though proc.killed is true", async () => {
  const controller = new AbortController();
  const { spawnProcess, spawned } = fakeSpawner((proc, signal) => {
    // Ignore SIGTERM; only SIGKILL ends the process.
    if (signal === "SIGKILL") setImmediate(() => proc.finish(null, "SIGKILL"));
  });
  const runner = createSubagentRunner({ spawnProcess, killGraceMs: 20 });

  const run = runner({ agent: AGENT, prompt: "hello", cwd: process.cwd(), signal: controller.signal });
  const proc = await spawned;
  controller.abort();

  // Negative case for the previous `if (!proc.killed) proc.kill("SIGKILL")`
  // logic: after SIGTERM is delivered `killed` is already true, so the old
  // fallback skipped SIGKILL and this run never settled.
  assert.equal(proc.killed, true);
  await settleWithin(run, 2_000, "runner");

  assert.deepEqual(proc.signals, ["SIGTERM", "SIGKILL"]);
});

test("the SIGKILL timer is released once the subagent exits after SIGTERM", async () => {
  const controller = new AbortController();
  const { spawnProcess, spawned } = fakeSpawner((proc, signal) => {
    if (signal === "SIGTERM") setImmediate(() => proc.finish(null, "SIGTERM"));
  });
  const runner = createSubagentRunner({ spawnProcess, killGraceMs: 60_000 });

  const run = runner({ agent: AGENT, prompt: "hello", cwd: process.cwd(), signal: controller.signal });
  const proc = await spawned;
  const baseline = countActiveTimeouts();
  controller.abort();
  await settleWithin(run, 2_000, "runner");

  assert.equal(countActiveTimeouts(), baseline, "kill fallback timer must not outlive the subagent");
  assert.deepEqual(proc.signals, ["SIGTERM"]);
});

test("aborting after the subagent finished does not signal the process", async () => {
  const controller = new AbortController();
  const { spawnProcess, spawned } = fakeSpawner();
  const runner = createSubagentRunner({ spawnProcess, killGraceMs: 20 });

  const run = runner({ agent: AGENT, prompt: "hello", cwd: process.cwd(), signal: controller.signal });
  const proc = await spawned;
  const message = { role: "assistant", content: [{ type: "text", text: "done" }], model: "test/model" };
  proc.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "message_end", message })}\n`));
  proc.finish(0);

  const result = await settleWithin(run, 2_000, "runner");
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputText, "done");
  assert.equal(result.model, "test/model");

  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(proc.signals, []);
});
