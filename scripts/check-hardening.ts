// ProofBrief — offline checks for the hardening changes:
//   1. the answers_question relevance gate (grounded but off-topic => human),
//   2. runtime validation of endpoint responses (fail closed on unknown values),
//   3. the analysis_incomplete state for retryable failures (429/5xx/network),
//      clearly distinct from a source conflict,
//   4. unknown passage ids cannot count as a source basis,
//   5. export offsets labeling for expanded sections.
//
// Fixtures are deterministic and inline, except the real endpoint outputs
// saved in tool-results/run4-conflict.json (live run, 2026-11-07).
//
//   bun scripts/check-hardening.ts
import { readFileSync } from "fs";
import {
  computeTriage,
  ANSWERS_QUESTION_THRESHOLD,
  type JoinedRerankResult,
} from "../src/lib/analysis";
import type { VerifyClaim } from "../src/lib/clocked";
import {
  validateVerifyResponse,
  validateRerankResponse,
  validateCompareResponse,
} from "../src/lib/validate";
import { joinResultToPassage, buildRegistry, type PassageEntry } from "../src/lib/registry";
import { buildMarkdown } from "../src/lib/export";
import { getCase } from "../src/lib/cases";
import { TRIAGE_META } from "../src/lib/display";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---- Fixtures ----

const supportedClaim = (claim: string): VerifyClaim => ({
  claim,
  supported: 0.95,
  contradicted: 0.03,
  not_stated: 0.01,
  not_a_claim: 0.01,
  verdict: "supported",
  evidence: {
    document: "doc-sp21",
    quote: "…",
    start: 0,
    end: 10,
    confidence: 0.9,
  },
});

const useResult = (passage: PassageEntry): JoinedRerankResult => ({
  index: 0,
  id: passage.id,
  action: "use",
  relevance_score: 0.99,
  document_score: 0.99,
  passage,
});

const conflictCase = getCase("conflict")!;
const registry = buildRegistry(conflictCase.docs);
const usable = useResult(registry[0]);
const overlappingPairs = [
  { a: "doc-sp21", b: "doc-dhs13", relation: "overlapping" as const, related: 0.9 },
];

const okInputs = (over: Partial<Parameters<typeof computeTriage>[0]> = {}) => ({
  rerankOk: true,
  rerankResults: [usable],
  verifyOk: true,
  claims: [supportedClaim("Claim A"), supportedClaim("Claim B")],
  answersQuestion: 0.96,
  compareOk: true,
  pairs: overlappingPairs,
  conflictIndexes: [],
  ...over,
});

console.log("1) Relevance gate — grounded but off-topic drafts are never ready");

const lowRelevance = computeTriage(okInputs({ answersQuestion: 0.31 }));
check("low answers_question => review_required", lowRelevance.state === "review_required", lowRelevance.state);
check(
  "reason names the answers_question score and the threshold",
  lowRelevance.reasons.some((r) => r.includes("answers_question score is 0.31") && r.includes("below 0.5")),
  lowRelevance.reasons,
);
check(
  "reason tells the human the claims may still be grounded",
  lowRelevance.reasons.some((r) => r.includes("may be grounded")),
  lowRelevance.reasons,
);

const missingScore = computeTriage(okInputs({ answersQuestion: undefined }));
check("missing answers_question => review_required (fail closed)", missingScore.state === "review_required", missingScore.state);
check(
  "reason explains the missing score",
  missingScore.reasons.some((r) => r.includes("no answers_question score")),
  missingScore.reasons,
);

const atThreshold = computeTriage(okInputs({ answersQuestion: ANSWERS_QUESTION_THRESHOLD }));
check("score at the threshold stays ready", atThreshold.state === "ready_for_review", atThreshold.state);

const highRelevance = computeTriage(okInputs());
check("happy path still ready_for_review", highRelevance.state === "ready_for_review", highRelevance.state);

const offTopicPlusConflict = computeTriage(
  okInputs({
    answersQuestion: 0.2,
    pairs: [{ a: "doc-sp21", b: "doc-rs26", relation: "conflicting" as const, related: 0.98 }],
    conflictIndexes: [0],
  }),
);
check(
  "a source conflict still wins the headline state (approval blocked either way)",
  offTopicPlusConflict.state === "conflict_needs_decision",
  offTopicPlusConflict.state,
);

console.log("2) analysis_incomplete — retryable failures, distinct from a conflict");

const throttled = computeTriage(
  okInputs({ rerankOk: false, rerankError: { code: "http_429", message: "rerank returned HTTP 429" } }),
);
check("429 => analysis_incomplete", throttled.state === "analysis_incomplete", throttled.state);
check(
  "first reason says retry later",
  throttled.reasons[0].includes("Analysis incomplete — retry later"),
  throttled.reasons,
);
check(
  "explicitly not a source conflict",
  throttled.reasons.some((r) => r.includes("not a source conflict")),
  throttled.reasons,
);

const serverDown = computeTriage(
  okInputs({ compareOk: false, compareError: { code: "http_503", message: "compare returned HTTP 503" } }),
);
check("5xx => analysis_incomplete", serverDown.state === "analysis_incomplete", serverDown.state);

const networkBlip = computeTriage(
  okInputs({ verifyOk: false, verifyError: { code: "network", message: "fetch failed" } }),
);
check("network error => analysis_incomplete", networkBlip.state === "analysis_incomplete", networkBlip.state);

const badRequest = computeTriage(
  okInputs({ verifyOk: false, verifyError: { code: "http_400", message: "grounding returned HTTP 400" } }),
);
check("non-retryable 4xx stays review_required (fail closed, not incomplete)", badRequest.state === "review_required", badRequest.state);

const invalidShape = computeTriage(
  okInputs({ compareOk: false, compareError: { code: "invalid_response", message: "Compare response failed validation" } }),
);
check("invalid_response => review_required", invalidShape.state === "review_required", invalidShape.state);

check(
  "TRIAGE_META labels the incomplete state as retry-later and not a conflict",
  TRIAGE_META.analysis_incomplete.title.includes("retry later") &&
    TRIAGE_META.analysis_incomplete.blurb.includes("not a source conflict"),
  TRIAGE_META.analysis_incomplete,
);

console.log("3) Runtime validation — unknown/missing values fail closed");

const realRun = JSON.parse(readFileSync("tool-results/run4-conflict.json", "utf8"));
// The app's saved result keeps the fields it uses; reassemble the documented
// response shape around the real claims to validate them.
const realVerifyResponse = {
  model: realRun.verify.model ?? "clocked-1.0",
  grounded: realRun.verify.grounded ?? 0,
  verdict: "grounded",
  threshold: realRun.verify.threshold ?? 0.5,
  claims: realRun.verify.claims.map(({ opposing: _o, closest: _c, ...rest }) => rest),
  answers_question: realRun.verify.answers_question,
};
check("real run4 Verify response passes validation", validateVerifyResponse(realVerifyResponse).ok);
check("real run4 Compare response passes validation", validateCompareResponse(realRun.compare).ok);
check(
  "real run4 Rerank response passes validation",
  validateRerankResponse({ model: "clocked-1.0", results: realRun.rerank.results.map(({ passage: _p, ...r }) => r) }).ok,
);

const goodVerify = {
  model: "clocked-1.0",
  grounded: 0.9,
  verdict: "grounded",
  threshold: 0.5,
  claims: [
    {
      claim: "x",
      supported: 0.9,
      contradicted: 0.05,
      not_stated: 0.03,
      not_a_claim: 0.02,
      verdict: "supported",
    },
  ],
  answers_question: 0.9,
};
check("well-formed verify passes", validateVerifyResponse(goodVerify).ok);

const unknownVerdict = structuredClone(goodVerify);
unknownVerdict.claims[0].verdict = "probably_supported";
check("unknown claim verdict rejected", !validateVerifyResponse(unknownVerdict).ok);

const outOfRange = structuredClone(goodVerify);
outOfRange.answers_question = 1.5;
check("answers_question outside 0–1 rejected", !validateVerifyResponse(outOfRange).ok);

const { claims: _claims, ...missingClaims } = goodVerify;
check("missing claims array rejected", !validateVerifyResponse(missingClaims).ok);

const badEvidence = structuredClone(goodVerify) as typeof goodVerify & {
  claims: { evidence?: unknown }[];
};
badEvidence.claims[0].evidence = { document: "doc-sp21", quote: "x", start: 100, end: 50, confidence: 0.9 };
check("evidence end-before-start rejected", !validateVerifyResponse(badEvidence).ok);

const goodRerank = {
  model: "clocked-1.0",
  results: [{ index: 0, id: "doc-sp21-s2", action: "use", relevance_score: 0.99, document_score: 0.99 }],
};
check("well-formed rerank passes", validateRerankResponse(goodRerank).ok);
const unknownAction = structuredClone(goodRerank);
unknownAction.results[0].action = "maybe";
check("unknown rerank action rejected", !validateRerankResponse(unknownAction).ok);
const negativeScore = structuredClone(goodRerank);
negativeScore.results[0].relevance_score = -0.1;
check("negative relevance_score rejected", !validateRerankResponse(negativeScore).ok);

const goodCompare = {
  model: "clocked-1.0",
  verdict: "no_conflicts",
  pairs: [{ a: "doc-a", b: "doc-b", relation: "overlapping", related: 0.8 }],
  conflicts: [],
};
check("well-formed compare passes", validateCompareResponse(goodCompare).ok);
const unknownRelation = structuredClone(goodCompare);
unknownRelation.pairs[0].relation = "tangential";
check("unknown compare relation rejected", !validateCompareResponse(unknownRelation).ok);

console.log("4) Unknown passage ids cannot count as a source basis");

const orphanResult: JoinedRerankResult = {
  index: 99,
  id: "doc-ghost-s9",
  action: "use",
  relevance_score: 0.99,
  document_score: 0.99,
  passage: joinResultToPassage({ index: 99, id: "doc-ghost-s9" }, registry, registry),
};
check("unknown id with out-of-range index joins to nothing", orphanResult.passage === undefined);
const orphanTriage = computeTriage(okInputs({ rerankResults: [orphanResult] }));
check(
  "a use result that joins to no passage => missing_evidence, never ready",
  orphanTriage.state === "missing_evidence",
  orphanTriage.state,
);

console.log("5) Export — expanded sections label offsets as the raw extraction's");

const md = buildMarkdown(conflictCase, realRun);
const crossCheck = md.slice(
  md.indexOf("## Source cross-check (Clocked Compare)"),
  md.indexOf("## Passage shortlist (Clocked Rerank)"),
);
check(
  "expanded side keeps the full section as the displayed text",
  crossCheck.includes("Northwind retains customer audit logs for 12 months"),
  crossCheck,
);
check(
  "offsets travel with the raw-heading note, not next to the section text",
  crossCheck.includes("(“## Audit log retention”, chars 186–208)"),
  crossCheck,
);
check(
  "offsets no longer sit next to the displayed section",
  !crossCheck.includes("chars 186–208: “"),
  crossCheck,
);
check(
  "non-expanded side keeps offsets inline as before",
  crossCheck.includes("chars 0–100: “"),
  crossCheck,
);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
