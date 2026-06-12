import assert from "node:assert/strict";
import test from "node:test";

const { parseStepEnvelope, ReviewContractError } = await import("../lib/review-contract.ts");

test("parseStepEnvelope enforces review contract", () => {
  const accept = parseStepEnvelope(
    'Looks good\n```json\n{"summary":"ok","judgment":"accept","acceptanceNote":"meets brief"}\n```',
    "/tmp/out.md",
    { isReviewStep: true },
  );
  assert.equal(accept.judgment, "accept");
  assert.equal(accept.acceptanceNote, "meets brief");

  const reject = parseStepEnvelope(
    'Needs work\n```json\n{"summary":"issues","judgment":"reject","findings":["fix tests"]}\n```',
    "/tmp/out.md",
    { isReviewStep: true },
  );
  assert.deepEqual(reject.findings, ["fix tests"]);

  assert.throws(
    () =>
      parseStepEnvelope(
        '```json\n{"summary":"x","judgment":"reject","findings":[]}\n```',
        "/tmp/out.md",
        { isReviewStep: true },
      ),
    ReviewContractError,
  );

  assert.throws(
    () =>
      parseStepEnvelope(
        '```json\n{"summary":"x","judgment":"accept"}\n```',
        "/tmp/out.md",
        { isReviewStep: true },
      ),
    ReviewContractError,
  );
});
