// ProofBrief — analysis types, shared instructions, and triage.
// The triage is computed only from live Clocked outputs: verdicts, relations,
// actions, and errors. Errors, missing evidence, and non-benign results are
// treated as review-required, never as approval.

import type { RerankResult, VerifyClaim, ComparePair } from "./clocked";
import type { PassageEntry } from "./registry";
import { resolveQuote } from "./registry";

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
 * One quote from one side of a Compare finding, resolved for display:
 * `quote` is what to show (heading markers stripped; a heading-only extraction
 * replaced by its full source section), `raw` is the endpoint's exact
 * extraction, and `expanded` records the substitution.
 */
export interface OpposingQuote {
  quote: string;
  raw: string;
  expanded: boolean;
  start?: number;
  end?: number;
  confidence?: number;
}

/** One document's side of a Compare-flagged pair. */
export interface PairSide {
  docId: string;
  docTitle: string;
  quotes: OpposingQuote[];
}

/**
 * The conflict join for a contradicted claim: which side of a Compare-flagged
 * pair disagrees with the claim (`opposing`), which side the claim's wording
 * matches (`claimSide`), or both sides when they cannot be told apart
 * (`indeterminate`). A display-only join between two live outputs — the
 * claim text from Verify and the paired passages from Compare — and nothing
 * is invented: similarity decides only what is *called* the opposing side;
 * every quote shown is an endpoint output.
 */
export interface OpposingEvidence {
  pairIndex: number;
  relation: string;
  /** The two sides of the flagged pair, in pair order. Always populated. */
  sides: PairSide[];
  /** The side the claim's wording matches; undefined when indeterminate. */
  claimSide?: PairSide;
  /** The side that disagrees with the claim; undefined when indeterminate. */
  opposing?: PairSide;
  /** True when the sides could not be told apart; the UI shows both. */
  indeterminate: boolean;
}

/**
 * A Verify claim enriched for display: nearest-source passages (Rerank) for
 * claims that are not established or carry no evidence quote, and the opposing
 * passage of a flagged pair (Compare) for contradicted claims. Both are
 * display-only; neither replaces a Verify verdict or changes the review state.
 */
export interface EnrichedClaim extends VerifyClaim {
  closest?: JoinedRerankResult[];
  opposing?: OpposingEvidence;
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

/**
 * Shared-token similarity between two texts, normalized by the smaller token
 * count (so a claim nearly contained in a passage scores close to 1). Used
 * only to decide which side of a flagged pair the claim's wording echoes.
 */
function tokenSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / Math.min(A.size, B.size);
}

/** A similarity below this means the claim does not meaningfully match a side. */
const MATCH_THRESHOLD = 0.2;
/** A side must beat the other by this factor to be called the claim's side. */
const MATCH_RATIO = 1.2;

/**
 * Join a contradicted claim to the opposing side of a Compare-flagged
 * conflicting pair.
 *
 * Which side is "opposing" is decided by wording, not by which document Verify
 * happened to cite as evidence (Verify may return either the passage the claim
 * echoes or the passage that contradicts it). The claim text is compared to
 * each side's quotes — resolved to their full sections when an extraction is
 * heading-only, so a bare heading cannot distort the comparison — and the side
 * the claim matches is the claim's side; the other side is the opposition.
 * When the two sides cannot be told apart, both are returned and the UI shows
 * them side by side. Every quote shown is a live endpoint output; only the
 * labels are derived. Returns undefined for claims that are not contradicted
 * or when no flagged pair exists at all.
 */
export function findOpposingEvidence(
  claim: VerifyClaim,
  pairs: ComparePair[],
  conflictIndexes: number[],
  docs: Record<string, { title: string; text: string }>,
): OpposingEvidence | undefined {
  if (claim.verdict !== "contradicted") return undefined;

  const sideFor = (pair: ComparePair, key: "a" | "b"): PairSide => {
    const docId = pair[key];
    const doc = docs[docId];
    const quotes: OpposingQuote[] = (pair.conflicts ?? [])
      .map((f) => f?.[key])
      .filter((q): q is { document: string; quote: string; start: number; end: number; confidence?: number } =>
        Boolean(q && q.quote),
      )
      .map((q) => {
        const resolved = resolveQuote(doc?.text, q.quote, q.start, q.end);
        return {
          quote: resolved.display,
          raw: resolved.raw,
          expanded: resolved.expanded,
          start: q.start,
          end: q.end,
          confidence: q.confidence,
        };
      });
    return { docId, docTitle: doc?.title ?? docId, quotes };
  };

  let fallback: OpposingEvidence | undefined;
  for (const idx of conflictIndexes) {
    const pair = pairs[idx];
    if (!pair) continue;
    const sideA = sideFor(pair, "a");
    const sideB = sideFor(pair, "b");
    const simA = tokenSimilarity(claim.claim, sideA.quotes.map((q) => q.quote).join(" "));
    const simB = tokenSimilarity(claim.claim, sideB.quotes.map((q) => q.quote).join(" "));

    if (simA >= MATCH_THRESHOLD && simA > simB * MATCH_RATIO && sideB.quotes.length > 0) {
      return {
        pairIndex: idx,
        relation: pair.relation,
        sides: [sideA, sideB],
        opposing: sideB,
        claimSide: sideA,
        indeterminate: false,
      };
    }
    if (simB >= MATCH_THRESHOLD && simB > simA * MATCH_RATIO && sideA.quotes.length > 0) {
      return {
        pairIndex: idx,
        relation: pair.relation,
        sides: [sideA, sideB],
        opposing: sideA,
        claimSide: sideB,
        indeterminate: false,
      };
    }
    // No confident match on this pair: keep it as the both-sides fallback.
    if (!fallback) {
      fallback = {
        pairIndex: idx,
        relation: pair.relation,
        sides: [sideA, sideB],
        indeterminate: true,
      };
    }
  }
  return fallback;
}
