// ProofBrief — analysis types, shared instructions, and triage.
// The triage is computed only from live Clocked outputs: verdicts, relations,
// actions, and errors. Errors, missing evidence, and non-benign results are
// treated as review-required, never as approval.

import type { RerankResult, VerifyClaim, ComparePair } from "./clocked";
import type { PassageEntry } from "./registry";

// Instructions sent with the three calls. They define the same entity, period,
// and scope rules that the Compare documentation requires, and the strict
// in-sources-only reading that the Verify documentation requires.

export const RERANK_INSTRUCTIONS =
  "You are selecting policy passages to support or reject a draft reply to the customer's question. " +
  "A passage is useful only if it states rules that bear on this question for this customer's context. " +
  "A passage about the same topic for a different region, plan, or account type does not apply.";

export const VERIFY_INSTRUCTIONS =
  "Judge each claim strictly against the supplied documents. Do not use outside knowledge. " +
  "Encryption in transit and encryption at rest are different controls. " +
  "If no source establishes a claim, it is not stated: absence from the sources is not falsehood.";

export const COMPARE_INSTRUCTIONS =
  "Define the same subject strictly: two statements conflict only when they describe the same data type or control, " +
  "over the same period definition, in the same scope. Retention rules for different data types " +
  "(for example audit logs versus backup archives, or full versus incremental backups) are different subjects, not conflicts. " +
  "A differing number or date alone does not establish a contradiction. Retain human review for document retirement or contractual conflicts.";

// ---- Analysis result (what the API route returns to the UI) ----

/**
 * One live Clocked request made during a run, as shown in the endpoint trace.
 * Enrichment lookups (nearest sources for a claim) are marked in `step`.
 */
export interface TraceEntry {
  step: string;
  endpoint: string;
  purpose: string;
  ok: boolean;
  latencyMs?: number;
  model?: string;
  inputTokens?: number;
  idempotencyKeyPrefix?: string;
  attempts?: number;
  error?: { code: string; message: string };
}

export interface JoinedRerankResult extends RerankResult {
  passage?: PassageEntry;
}

/**
 * A Verify claim enriched with nearest-source passages for not_stated claims.
 * `closest` is display-only enrichment from Rerank; it never replaces the
 * Verify verdict and never changes the review state.
 */
export interface EnrichedClaim extends VerifyClaim {
  closest?: JoinedRerankResult[];
}

export interface TriageStateInfo {
  state:
    | "ready_for_review"
    | "conflict_needs_decision"
    | "missing_evidence"
    | "review_required";
  reasons: string[];
}

export interface AnalysisResult {
  caseId: string;
  ranAt: string;
  triage: TriageStateInfo;
  trace: TraceEntry[];
  rerank: {
    ok: boolean;
    error?: { code: string; message: string };
    model?: string;
    results: JoinedRerankResult[];
  };
  verify: {
    ok: boolean;
    error?: { code: string; message: string };
    model?: string;
    grounded?: number;
    threshold?: number;
    claims: EnrichedClaim[];
    answers_question?: number;
  };
  compare: {
    ok: boolean;
    error?: { code: string; message: string };
    model?: string;
    verdict?: string;
    pairs: ComparePair[];
    conflictIndexes: number[];
  };
}

/**
 * Compute the review state from live endpoint outputs.
 *
 * - Any endpoint error, or no usable Rerank passage, => review_required.
 * - A Compare pair flagged conflicting, or a Verify claim contradicted,
 *   => conflict_needs_decision (approval is blocked).
 * - Any counted claim not established by the sources => missing_evidence.
 * - Otherwise => ready_for_review (a human still makes the final call).
 */
export function computeTriage(input: {
  rerankOk: boolean;
  rerankError?: { code: string; message: string };
  rerankResults: JoinedRerankResult[];
  verifyOk: boolean;
  verifyError?: { code: string; message: string };
  claims: VerifyClaim[];
  compareOk: boolean;
  compareError?: { code: string; message: string };
  pairs: ComparePair[];
  conflictIndexes: number[];
}): TriageStateInfo {
  const reasons: string[] = [];

  const errors: [boolean, { code: string; message: string } | undefined, string][] = [
    [input.rerankOk, input.rerankError, "Rerank"],
    [input.verifyOk, input.verifyError, "Verify"],
    [input.compareOk, input.compareError, "Compare"],
  ];
  for (const [ok, err, name] of errors) {
    if (!ok && err) reasons.push(`${name} could not complete (${err.code}): ${err.message}`);
  }
  if (reasons.length > 0) {
    return { state: "review_required", reasons };
  }

  const useCount = input.rerankResults.filter((r) => r.action === "use").length;
  const noUsablePassage = useCount === 0;
  if (noUsablePassage) {
    reasons.push("Rerank marked no passage as usable for this question, so there is no source basis to check the draft against.");
  }

  const conflicts: string[] = [];
  for (const idx of input.conflictIndexes) {
    const pair = input.pairs[idx];
    if (pair) {
      conflicts.push(
        `Sources ${pair.a} and ${pair.b} are flagged conflicting (related probability ${pair.related.toFixed(2)}).`,
      );
    }
  }
  const contradicted = input.claims.filter(
    (c) => c.counted !== false && c.verdict === "contradicted",
  );
  for (const c of contradicted) {
    reasons.push(`A claim conflicts with a source: "${c.claim.slice(0, 120)}${c.claim.length > 120 ? "…" : ""}"`);
  }
  if (conflicts.length > 0 || contradicted.length > 0) {
    return { state: "conflict_needs_decision", reasons: [...conflicts, ...reasons] };
  }

  const notStated = input.claims.filter(
    (c) => c.counted !== false && c.verdict === "not_stated",
  );
  for (const c of notStated) {
    reasons.push(`No source establishes the claim: "${c.claim.slice(0, 120)}${c.claim.length > 120 ? "…" : ""}"`);
  }
  if (notStated.length > 0 || noUsablePassage) {
    return { state: "missing_evidence", reasons };
  }

  if (input.claims.length === 0) {
    reasons.push("Verify returned no claims for this draft; treat as review-required.");
    return { state: "review_required", reasons };
  }

  return {
    state: "ready_for_review",
    reasons: ["Every counted claim is supported by these documents and no source pair is flagged conflicting. A human makes the final call."],
  };
}
