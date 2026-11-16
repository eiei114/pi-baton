import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions,
  NO_ACTIVE_RUN_MESSAGE,
  NO_HISTORY_MESSAGE,
  parseJsonLines,
  parseRpcStdout,
  redactLocalPaths,
  REQUIRED_COMMANDS,
  reloadProcessAssertion,
  SDK_NAMES,
  sdkPinMismatch,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

const registration = {
  type: "response",
  command: "get_commands",
  success: true,
  data: { commands: REQUIRED_COMMANDS.map((name) => ({ name, source: "extension" })) },
};
const prompt = { type: "response", command: "prompt", success: true, data: { disposition: "handled" } };
const notification = (message) => ({
  type: "extension_ui_request",
  method: "notify",
  message,
  notifyType: "info",
});
const observed = (responses = [registration, prompt, notification(NO_HISTORY_MESSAGE)], fullOutput = "", exit_code = 0) =>
  ({ responses, fullOutput, exit_code, expectedVersion: "1.5.0" });

test("behavior contract identifies Pi SDK v2 and parses LF/CRLF JSON records strictly", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(parseJsonLines(`${JSON.stringify(prompt)}\r\n\n`), [prompt]);
  assert.throws(() => parseJsonLines(`bad json\r\n${JSON.stringify(prompt)}\n`), /Invalid JSON Lines record at line 1/);
  assert.deepEqual(parseJsonLines('{"type":"response"', { allowIncompleteTrailing: true }), []);
});

test("RPC stdout validation fails the smoke case for any malformed record", () => {
  const valid = parseRpcStdout(`${JSON.stringify(prompt)}\n`);
  assert.deepEqual(valid.responses, [prompt]);
  assert.equal(valid.validation.passed, true);

  const malformed = parseRpcStdout(`${JSON.stringify(prompt)}\nbad json\n`);
  assert.deepEqual(malformed.responses, []);
  assert.equal(malformed.validation.id, "valid_jsonl_stdout");
  assert.equal(malformed.validation.passed, false);
  assert.equal(behaviorAssertions("happy_path", observed(malformed.responses))[0].passed, false);
});

test("evidence redaction removes workspace paths in native and JSON-style separators", () => {
  const workspace = "C:\\Users\\Keisu\\repo";
  const evidence = `${workspace}\\extensions\\index.ts ${workspace.replaceAll("\\", "/")}/scripts/check.mjs`;
  assert.equal(
    redactLocalPaths(evidence, [[workspace, "<workspace>"]]),
    "<workspace>\\extensions\\index.ts <workspace>/scripts/check.mjs",
  );
  const jsonEscapedEvidence = `${workspace.replaceAll("\\", "\\\\")}\\\\extensions\\\\index.ts`;
  assert.equal(
    redactLocalPaths(jsonEscapedEvidence, [[workspace, "<workspace>"]]),
    "<workspace>\\\\extensions\\\\index.ts",
  );
});

test("extension registration requires all six commands from actual extension sources", () => {
  assert.equal(behaviorAssertions("extension_load", observed())[0].passed, true);
  for (const commands of [[], REQUIRED_COMMANDS.slice(1).map((name) => ({ name, source: "extension" })),
    REQUIRED_COMMANDS.map((name) => ({ name, source: "prompt" }))]) {
    const result = behaviorAssertions("extension_load", observed([{ ...registration, data: { commands } }]))[0];
    assert.equal(result.id, "extension_registered");
    assert.equal(result.passed, false);
  }
});

test("happy path requires the handled Baton history response and exact feature notice", () => {
  assert.equal(behaviorAssertions("happy_path", observed())[0].passed, true);
  for (const responses of [[], [registration, { ...prompt, success: false }], [registration, prompt],
    [registration, prompt, notification("wrong output")],
    [registration, prompt, { ...notification(NO_HISTORY_MESSAGE), notifyType: "error" }]]) {
    assert.equal(behaviorAssertions("happy_path", observed(responses))[0].passed, false);
  }
});

test("error path requires actual handled no-active-run behavior", () => {
  assert.equal(behaviorAssertions("error_path", observed([registration, prompt, notification(NO_ACTIVE_RUN_MESSAGE)]))[0].passed, true);
  for (const responses of [[], [registration, { ...prompt, data: { disposition: "started" } }, notification(NO_ACTIVE_RUN_MESSAGE)],
    [registration, prompt, notification(NO_HISTORY_MESSAGE)]]) {
    assert.equal(behaviorAssertions("error_path", observed(responses))[0].passed, false);
  }
});

test("reload requires second-process registration, feature response, and clean actual exit", () => {
  const good = behaviorAssertions("reload_cleanup", observed());
  assert.deepEqual(good.map((item) => item.id), [
    "reloaded_extension_registered",
    "reloaded_feature_response",
    "clean_shutdown",
  ]);
  assert.ok(good.every((item) => item.passed));
  for (const [responses, output, exit_code] of [
    [[], "", 0],
    [[registration], "", 0],
    [[registration, prompt], "", 0],
    [[registration, prompt, notification(NO_HISTORY_MESSAGE)], "shutdown error", 0],
    [[registration, prompt, notification(NO_HISTORY_MESSAGE)], "", 1],
  ]) {
    assert.ok(behaviorAssertions("reload_cleanup", observed(responses, output, exit_code)).some((item) => !item.passed));
  }
});

test("reload lifecycle requires two distinct Pi processes and a clean first shutdown", () => {
  const first = { process_id: 101, exit_code: 0, passed: true };
  const second = { process_id: 102, exit_code: 0, passed: true };
  assert.equal(reloadProcessAssertion(first, second).passed, true);
  for (const [initial, reloaded] of [
    [{ ...first, process_id: null }, second],
    [first, { ...second, process_id: first.process_id }],
    [{ ...first, exit_code: 1 }, second],
    [{ ...first, passed: false }, second],
  ]) {
    assert.equal(reloadProcessAssertion(initial, reloaded).passed, false);
  }
});

test("smoke gate reads the SDK wave from the manifest pins instead of a literal", () => {
  const installedAt = (version) => Object.fromEntries(SDK_NAMES.map((name) => [name, version]));
  assert.equal(sdkPinMismatch({ devDependencies: installedAt("1.5.2") }, installedAt("1.5.2")), null,
    "a pinned wave that matches the installed packages must pass, whatever its version");

  // A literal wave in the harness made every Dependabot bump of the pi-sdk group
  // fail even when the manifest and node_modules already agreed.
  assert.equal(sdkPinMismatch({ devDependencies: installedAt("9.9.9") }, installedAt("9.9.9")), null,
    "the gate must not depend on one specific SDK version");

  const drifted = sdkPinMismatch({ devDependencies: { ...installedAt("1.5.2"), [SDK_NAMES[0]]: "1.5.0" } }, installedAt("1.5.2"));
  assert.match(drifted, new RegExp(`${SDK_NAMES[0]} to match its package.json pin 1.5.0; found 1.5.2`));

  const missingPin = installedAt("1.5.2");
  delete missingPin[SDK_NAMES[1]];
  assert.match(sdkPinMismatch({ devDependencies: missingPin }, installedAt("1.5.2")),
    new RegExp(`exact Pi SDK dev/test pin for ${SDK_NAMES[1]}`));

  const notInstalled = installedAt("1.5.2");
  delete notInstalled[SDK_NAMES[2]];
  assert.match(sdkPinMismatch({ devDependencies: installedAt("1.5.2") }, notInstalled),
    new RegExp(`pinned Pi SDK ${SDK_NAMES[2]} 1.5.2 to be installed`));
});

test("native shell boundary requires exact pinned CLI version and a zero exit", () => {
  assert.equal(behaviorAssertions("host_shell", observed([], "1.5.0\r\n"))[0].passed, true);
  for (const [output, exit_code] of [["", 0], ["11.2.0", 0], ["1.4.0", 0], ["1.5.0", 1]]) {
    assert.equal(behaviorAssertions("host_shell", observed([], output, exit_code))[0].passed, false);
  }
});
