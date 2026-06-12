import type { ReviewJudgment, StructuredStepEnvelope } from "./types.ts";

export class ReviewContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewContractError";
  }
}

interface ParsedJsonBlock {
  summary?: string;
  judgment?: ReviewJudgment;
  findings?: unknown;
  acceptanceNote?: string;
}

function extractJsonBlock(text: string): ParsedJsonBlock | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();

  const start = candidate.lastIndexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ParsedJsonBlock;
  } catch {
    return undefined;
  }
}

function fallbackSummary(text: string): string {
  const withoutFence = text.replace(/```[\s\S]*?```/g, "").trim();
  const firstParagraph = withoutFence.split(/\n\s*\n/)[0]?.trim();
  if (!firstParagraph) return "Step completed";
  return firstParagraph.length > 500 ? `${firstParagraph.slice(0, 497)}...` : firstParagraph;
}

function normalizeFindings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function parseStepEnvelope(
  outputText: string,
  rawOutputPath: string,
  options: { isReviewStep: boolean },
): StructuredStepEnvelope {
  const parsed = extractJsonBlock(outputText);
  const summary = parsed?.summary?.trim() || fallbackSummary(outputText);

  const envelope: StructuredStepEnvelope = {
    summary,
    rawOutputPath,
  };

  if (!options.isReviewStep) {
    return envelope;
  }

  const judgment = parsed?.judgment;
  if (judgment !== "accept" && judgment !== "reject") {
    throw new ReviewContractError('Review step must return judgment "accept" or "reject"');
  }

  envelope.judgment = judgment;

  if (judgment === "reject") {
    const findings = normalizeFindings(parsed?.findings);
    if (findings.length === 0) {
      throw new ReviewContractError("Review reject must include non-empty findings");
    }
    envelope.findings = findings;
    return envelope;
  }

  const acceptanceNote = parsed?.acceptanceNote?.trim();
  if (!acceptanceNote) {
    throw new ReviewContractError("Review accept must include an acceptanceNote");
  }
  envelope.acceptanceNote = acceptanceNote;
  return envelope;
}
