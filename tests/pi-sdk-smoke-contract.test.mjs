import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions,
  NO_ACTIVE_RUN_MESSAGE,
  NO_HISTORY_MESSAGE,
  parseJsonLines,
  REQUIRED_COMMANDS,
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
  ({ responses, fullOutput, exit_code, expectedVersion: "1.1.0" });

test("behavior contract identifies Pi SDK v2 and parses LF/CRLF JSON records", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(parseJsonLines(`bad json\r\n${JSON.stringify(prompt)}\n\n`), [prompt]);
});

test("extension registration requires all five commands from actual extension sources", () => {
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

test("native shell boundary requires exact pinned CLI version and a zero exit", () => {
  assert.equal(behaviorAssertions("host_shell", observed([], "1.1.0\r\n"))[0].passed, true);
  for (const [output, exit_code] of [["", 0], ["11.1.0", 0], ["1.0.0", 0], ["1.1.0", 1]]) {
    assert.equal(behaviorAssertions("host_shell", observed([], output, exit_code))[0].passed, false);
  }
});
