import assert from "node:assert/strict";
import test from "node:test";

const { default: registerBaton } = await import("../extensions/index.ts");

test("extension registers Baton commands only", () => {
  const commands = [];
  const fakePi = {
    registerCommand(name, options) {
      commands.push([name, options]);
    },
  };

  registerBaton(fakePi);

  assert.deepEqual(
    commands.map(([name]) => name).sort(),
    ["baton:new", "baton:run", "baton:start", "baton:status"],
  );
});
