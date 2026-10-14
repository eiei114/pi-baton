export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const REQUIRED_COMMANDS = [
  "baton:new",
  "baton:start",
  "baton:run",
  "baton:status",
  "baton:history",
];
export const NO_HISTORY_MESSAGE =
  "No completed or failed Baton runs yet. Start one with /baton:start, then /baton:run.";
export const NO_ACTIVE_RUN_MESSAGE =
  "No active Baton run. Start one with /baton:start after choosing a workflow and task brief.";
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error|unhandled error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension|extension_error/i;

export function parseJsonLines(output, { allowIncompleteTrailing = false } = {}) {
  const lines = output.split(/\r?\n/);
  if (allowIncompleteTrailing && !output.endsWith("\n")) lines.pop();
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      throw new SyntaxError(`Invalid JSON Lines record at line ${index + 1}`);
    }
  });
}

export function parseRpcStdout(output) {
  try {
    return {
      responses: parseJsonLines(output),
      validation: assertion("valid_jsonl_stdout", "Every non-empty Pi RPC stdout line is valid JSON", "all records valid", true),
    };
  } catch (error) {
    return {
      responses: [],
      validation: assertion("valid_jsonl_stdout", "Every non-empty Pi RPC stdout line is valid JSON", error.message, false),
    };
  }
}

export function redactLocalPaths(output, paths) {
  let redacted = String(output);
  const variants = new Map();
  for (const [path, label] of paths) {
    if (!path) continue;
    const variantsForPath = [path, path.replaceAll("\\", "/"), path.replaceAll("/", "\\")];
    variantsForPath.push(...variantsForPath.map((variant) => JSON.stringify(variant).slice(1, -1)));
    for (const variant of new Set(variantsForPath)) {
      variants.set(variant, label);
    }
  }

  for (const [path, label] of [...variants].sort(([left], [right]) => right.length - left.length)) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    redacted = redacted.replace(new RegExp(escaped, "gi"), label);
  }
  return redacted;
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function commandRegistration(responses) {
  const response = responses.find((row) => row?.type === "response" && row.command === "get_commands");
  const commands = response?.success === true && Array.isArray(response.data?.commands)
    ? response.data.commands
    : [];
  const registered = commands.filter((command) => command.source === "extension").map((command) => command.name);
  return { registered, passed: REQUIRED_COMMANDS.every((name) => registered.includes(name)) };
}

function featureNotification(responses, expectedMessage) {
  const prompt = responses.find((row) => row?.type === "response" && row.command === "prompt");
  const notification = responses.find((row) => row?.type === "extension_ui_request"
    && row.method === "notify" && row.message === expectedMessage && row.notifyType === "info");
  return {
    prompt: prompt ?? null,
    notification: notification ?? null,
    passed: prompt?.success === true && prompt.data?.disposition === "handled" && !!notification,
  };
}

export function behaviorAssertions(name, { responses, fullOutput, exit_code, expectedVersion }) {
  const registration = commandRegistration(responses);
  if (name === "extension_load") {
    return [assertion("extension_registered", "The actual Pi RPC host lists all five Baton extension commands",
      registration.registered, registration.passed)];
  }
  if (name === "happy_path") {
    const feature = featureNotification(responses, NO_HISTORY_MESSAGE);
    return [assertion("feature_response", "`/baton:history` returns the actual empty-history notice as a handled command",
      { prompt: feature.prompt, notification: feature.notification }, feature.passed)];
  }
  if (name === "error_path") {
    const feature = featureNotification(responses, NO_ACTIVE_RUN_MESSAGE);
    return [assertion("handled_error", "`/baton:run` without an active run returns the handled no-active-run notice",
      { prompt: feature.prompt, notification: feature.notification }, feature.passed)];
  }
  if (name === "reload_cleanup") {
    const feature = featureNotification(responses, NO_HISTORY_MESSAGE);
    const clean = exit_code === 0 && !UNHANDLED_ERROR_PATTERN.test(fullOutput);
    return [
      assertion("reloaded_extension_registered", "The second actual Pi process registers all Baton commands",
        registration.registered, registration.passed),
      assertion("reloaded_feature_response", "The second process handles `/baton:history` and returns its actual notice",
        { prompt: feature.prompt, notification: feature.notification }, feature.passed),
      assertion("clean_shutdown", "The second Pi host exits zero without unhandled or shutdown errors",
        { exit_code, has_unhandled_error: UNHANDLED_ERROR_PATTERN.test(fullOutput) }, clean),
    ];
  }
  if (name === "host_shell") {
    return [assertion("native_shell_boundary", "The native host shell launches the pinned local Pi CLI and returns its exact version",
      { exit_code, output: fullOutput.trim(), expectedVersion }, exit_code === 0 && fullOutput.trim() === expectedVersion)];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
