import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  SDK_NAMES,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => [
  name,
  readJson(resolve(root, "node_modules", name, "package.json")).version,
]));
for (const name of SDK_NAMES) {
  if (manifest.devDependencies?.[name] !== sdkVersions[name] || sdkVersions[name] !== "1.1.0") {
    throw new Error(`Smoke requires exact Pi SDK 1.1.0 dev/test pins for ${name}; found ${sdkVersions[name]}`);
  }
}

const codingAgentDir = resolve(root, "node_modules/@earendil-works/pi-coding-agent");
const piManifest = readJson(resolve(codingAgentDir, "package.json"));
const piCli = resolve(codingAgentDir, piManifest.bin.pi);
const tempRoot = mkdtempSync(resolve(tmpdir(), "pi-baton-sdk-smoke-"));
const agentDir = resolve(tempRoot, "agent");
const extensionPath = resolve(root, "extensions/index.ts");
mkdirSync(agentDir, { recursive: true });
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
const rpcArgs = [
  "--offline",
  "--no-session",
  "--no-tools",
  "--no-skills",
  "--no-context-files",
  "--no-prompt-templates",
  "--no-extensions",
  "-e",
  extensionPath,
  "--mode",
  "rpc",
];

function runPi(name, messages) {
  const cwd = resolve(tempRoot, `project-${name}`);
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [piCli, ...rpcArgs], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let failure;
    let inputEnded = false;
    let settled = false;
    let deadlineTimer;
    let cleanupTimer;

    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(cleanupTimer);
      resolveResult(evaluate(name, { status, stdout, stderr, error: failure }));
    };
    const terminateAfterFailure = (error) => {
      if (settled || failure) return;
      failure = error;
      clearTimeout(deadlineTimer);
      child.kill();
      cleanupTimer = setTimeout(() => finish(child.exitCode ?? 1), 1_000);
    };
    const closeInputAndWaitForExit = () => {
      if (inputEnded || settled) return;
      inputEnded = true;
      child.stdin.end();
      cleanupTimer = setTimeout(() => {
        failure = new Error("Pi did not exit within 1000ms after RPC stdin closed");
        child.kill();
        finish(child.exitCode ?? 1);
      }, 1_000);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const responses = parseJsonLines(stdout);
      const hasPromptResponse = responses.some((row) => row?.type === "response" && row.command === "prompt");
      const hasCommandList = responses.some((row) => row?.type === "response" && row.command === "get_commands");
      if ((name === "extension_load" && hasCommandList)
        || ((name === "happy_path" || name === "error_path") && hasPromptResponse)
        || (name === "reload_cleanup" && hasPromptResponse && hasCommandList)) {
        closeInputAndWaitForExit();
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => terminateAfterFailure(error));
    child.once("close", (status) => finish(status));
    child.stdin.once("error", (error) => {
      if (!inputEnded) terminateAfterFailure(error);
    });
    deadlineTimer = setTimeout(() => terminateAfterFailure(new Error("Pi RPC response exceeded the 15000ms deadline")), 15_000);
    child.stdin.write(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
  });
}

function runHostShell() {
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const powershell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const command = `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`;
    return evaluate("host_shell", spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }));
  }
  const command = '"$1" "$2" --no-extensions --version';
  return evaluate("host_shell", spawnSync("/bin/sh", ["-c", command, "pi-host-shell", process.execPath, piCli], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  }));
}

function evaluate(name, result) {
  const fullOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exit_code = result.status ?? 1;
  const responses = [...parseJsonLines(result.stdout ?? ""), ...parseJsonLines(result.stderr ?? "")];
  const assertions = behaviorAssertions(name, {
    responses,
    fullOutput,
    exit_code,
    expectedVersion: sdkVersions["@earendil-works/pi-coding-agent"],
  });
  const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(fullOutput);
  const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput);
  return {
    name,
    command: "npm run smoke:pi",
    exit_code,
    passed: exit_code === 0 && !result.error && !hasUnhandledError && !hasLoadError && assertions.every((item) => item.passed),
    evidence: fullOutput.slice(-6000) || String(result.error?.message ?? "No output captured"),
    assertions,
    hasUnhandledError,
    hasLoadError,
  };
}

try {
  const cases = [
    await runPi("extension_load", [{ type: "get_commands" }]),
    await runPi("happy_path", [{ type: "prompt", message: "/baton:history" }]),
    await runPi("error_path", [{ type: "prompt", message: "/baton:run" }]),
    await runPi("reload_cleanup", [
      { type: "get_commands" },
      { type: "prompt", message: "/baton:history" },
    ]),
    runHostShell(),
  ];
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; actual Pi RPC extension commands with offline startup",
    unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
    extension_load_errors: cases.filter((item) => item.hasLoadError || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ hasUnhandledError, hasLoadError, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })),
  }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
