// ProofBrief — offline checks for source-reference integrity:
//   1. a Rerank result's id is authoritative: an unknown nonempty id NEVER
//      falls back to a (valid) index; the index is used only when the id is
//      absent, as the API contract permits ("join them back ... by index or
//      id"), and an out-of-range index joins to nothing;
//   2. a "use" result that joins to no passage is a response-integrity
//      failure => review_required (fail closed), never "ready" and never
//      mistaken for missing evidence or an incomplete run;
//   3. Verify evidence must cite a submitted document at offsets inside it;
//      anything else is withheld (never displayed as evidence) and fails the
//      state closed — the verdict itself is left untouched;
//   4. Compare pairs must be between submitted documents and findings must
//      cite their own side's document within bounds; dropped pairs have their
//      conflict indexes remapped, and an invalid reference never masquerades
//      as a source conflict;
//   5. the opposing-evidence join still works on reference-checked data;
//   6. the exported packet mirrors the withholding instead of the evidence;
//   7. transport failures keep their meaning: a retryable error stays
//      analysis_incomplete even when integrity issues exist.
//
// Companion suites: check-time-budget.ts covers deadline exhaustion and
// retryable 429/timeout; check-hardening.ts covers shape validation.
//
//   bun scripts/check-source-integrity.ts
import {
  computeTriage,
  findOpposingEvidence,
  type JoinedRerankResult,
} from "../src/lib/analysis";
import type { VerifyClaim, ComparePair } from "../src/lib/clocked";
import { joinResultToPassage, buildRegistry, type PassageEntry } from "../src/lib/registry";
import { sanitizeVerifyClaims, sanitizeCompare } from "../src/lib/integrity";
import { buildMarkdown } from "../src/lib/export";
import { getCase } from "../src/lib/cases";
import type { AnalysisResult } from "../src/lib/analysis";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---- Fixtures: the real conflict-case documents ----

const conflictCase = getCase("conflict")!;
const registry = buildRegistry(conflictCase.docs);
const docMap = Object.fromEntries(
  conflictCase.docs.map((d) => [d.id, { title: d.title, text: d.text }]),
);
const docSp21 = docMap["doc-sp21"];
const docRs26 = docMap["doc-rs26"];

const supportedClaim = (claim: string): VerifyClaim => ({
  claim,
  supported: 0.95,
  contradicted: 0.03,
  not_stated: 0.01,
  not_a_claim: 0.01,
  verdict: "supported",
  evidence: { document: "doc-sp21", quote: "…", start: 0, end: 10, confidence: 0.9 },
});

const useResult = (passage: PassageEntry | undefined): JoinedRerankResult => ({
  index: 0,
  id: passage?.id,
  action: "use",
  relevance_score: 0.99,
  document_score: 0.99,
  passage,
});

const overlappingPairs: ComparePair[] = [
  { a: "doc-sp21", b: "doc-dhs13", relation: "overlapping", related: 0.9 },
];

const okInputs = (over: Partial<Parameters<typeof computeTriage>[0]> = {}) => ({
  rerankOk: true,
  rerankResults: [useResult(registry[0])],
  verifyOk: true,
  claims: [supportedClaim("Claim A"), supportedClaim("Claim B")],
  answersQuestion: 0.96,
  compareOk: true,
  pairs: overlappingPairs,
  conflictIndexes: [],
  ...over,
});

console.log("1) Rerank join — the id is authoritative, the index is a last resort");

const byKnownId = joinResultToPassage(
  { index: 2, id: registry[0].id },
  registry,
  registry,
);
check(
  "known id wins even when the index points elsewhere",
  byKnownId?.id === registry[0].id,
  byKnownId?.id,
);
check(
  "unknown nonempty id with a VALID index joins to nothing (never a different passage)",
  joinResultToPassage({ index: 0, id: "doc-ghost-s1" }, registry, registry) === undefined,
);
check(
  "unknown id keeps failing closed at any index",
  joinResultToPassage({ index: 1, id: "not-a-passage" }, registry, registry) === undefined,
);
check(
  "absent id falls back to the index (the contract permits it)",
  joinResultToPassage({ index: 1 }, registry, registry)?.id === registry[1].id,
);
check(
  "empty-string id counts as absent: index fallback",
  joinResultToPassage({ index: 1, id: "" }, registry, registry)?.id === registry[1].id,
);
check(
  "absent id with an out-of-range index joins to nothing",
  joinResultToPassage({ index: registry.length }, registry, registry) === undefined,
);
check(
  "absent id with a negative index joins to nothing",
  joinResultToPassage({ index: -1 }, registry, registry) === undefined,
);

console.log("2) An unjoinable \"use\" result is an integrity failure, not a source basis");

const orphanUse: JoinedRerankResult = {
  ...useResult(undefined),
  // Unknown id while index 0 is a perfectly valid passage — the old join would
  // have silently attributed this result to registry[0].
  id: "doc-ghost-s1",
  index: 0,
};
const orphanTriage = computeTriage(okInputs({ rerankResults: [orphanUse] }));
check(
  "use result with unknown id + valid index => review_required (fail closed)",
  orphanTriage.state === "review_required",
  orphanTriage.state,
);
check(
  "reason says it did not join back to any submitted passage",
  orphanTriage.reasons.some((r) => r.includes("did not join back to any passage")),
  orphanTriage.reasons,
);
check(
  "the fail-closed note separates integrity from conflicts and verdicts",
  orphanTriage.reasons.some((r) => r.includes("response-integrity check") && r.includes("not a source conflict")),
  orphanTriage.reasons,
);
check(
  "never ready and never analysis_incomplete",
  orphanTriage.state !== "ready_for_review" && orphanTriage.state !== "analysis_incomplete",
  orphanTriage.state,
);
const noUseAtAll = computeTriage(
  okInputs({
    rerankResults: [
      { index: 0, action: "skip", relevance_score: 0.2, document_score: 0.3, passage: registry[0] },
    ],
  }),
);
check(
  "zero use results (legitimately none usable) still => missing_evidence",
  noUseAtAll.state === "missing_evidence",
  noUseAtAll.state,
);
check("happy path control stays ready", computeTriage(okInputs()).state === "ready_for_review");

console.log("3) Verify evidence must reference a submitted document, within bounds");

const ghostEvidenceClaim = supportedClaim("Claim A");
(ghostEvidenceClaim.evidence as NonNullable<VerifyClaim["evidence"]>).document = "doc-ghost";
const ghostSanitized = sanitizeVerifyClaims([ghostEvidenceClaim, supportedClaim("Claim B")], docMap);
check(
  "unknown evidence document is withheld (evidence removed)",
  ghostSanitized.claims[0].evidence === undefined,
  ghostSanitized.claims[0],
);
check(
  "the withheld reason names the ghost document",
  ghostSanitized.claims[0].evidenceWithheld?.includes("doc-ghost") === true,
  ghostSanitized.claims[0].evidenceWithheld,
);
check(
  "an issue is recorded for the review state",
  ghostSanitized.issues.length === 1 && ghostSanitized.issues[0].includes("claim #1"),
  ghostSanitized.issues,
);
check(
  "verdict and scores are preserved (the verdict is the endpoint's, only the reference is rejected)",
  ghostSanitized.claims[0].verdict === "supported" && ghostSanitized.claims[0].supported === 0.95,
  ghostSanitized.claims[0],
);
check(
  "a valid evidence reference on another claim is untouched",
  ghostSanitized.claims[1].evidence?.document === "doc-sp21" && ghostSanitized.claims[1].evidenceWithheld === undefined,
  ghostSanitized.claims[1],
);
check(
  "composed like the route: withheld evidence => review_required, never ready",
  computeTriage(
    okInputs({ claims: ghostSanitized.claims, integrityIssues: ghostSanitized.issues }),
  ).state === "review_required",
);

const badOffsetsClaim = supportedClaim("Claim A");
{
  const ev = badOffsetsClaim.evidence!;
  ev.start = 0;
  ev.end = docSp21.text.length + 1000; // schema-valid (end ≥ start), outside the document
}
const badOffsets = sanitizeVerifyClaims([badOffsetsClaim], docMap);
check(
  "evidence offsets beyond the document length are withheld",
  badOffsets.claims[0].evidence === undefined &&
    badOffsets.claims[0].evidenceWithheld?.includes("characters long") === true,
  badOffsets.claims[0].evidenceWithheld,
);
check(
  "the issue names the submitted document's real length",
  badOffsets.issues[0]?.includes(`${docSp21.text.length} characters long`),
  badOffsets.issues,
);
check(
  "composed: bad offsets => review_required",
  computeTriage(okInputs({ claims: badOffsets.claims, integrityIssues: badOffsets.issues })).state ===
    "review_required",
);

const endExactlyAtLength = supportedClaim("Claim A");
(endExactlyAtLength.evidence as NonNullable<VerifyClaim["evidence"]>).end = docSp21.text.length;
const boundaryOk = sanitizeVerifyClaims([endExactlyAtLength], docMap);
check(
  "offsets ending exactly at the document length are valid (boundary)",
  boundaryOk.claims[0].evidence !== undefined && boundaryOk.issues.length === 0,
  boundaryOk.issues,
);

const noEvidenceClaim = supportedClaim("Claim A");
noEvidenceClaim.evidence = null;
const noEvidence = sanitizeVerifyClaims([noEvidenceClaim], docMap);
check(
  "a claim without evidence is untouched (no issue, no marker)",
  noEvidence.claims[0].evidence === null &&
    noEvidence.claims[0].evidenceWithheld === undefined &&
    noEvidence.issues.length === 0,
  noEvidence,
);

console.log("4) Compare pairs and findings must reference the submitted documents");

const ghostPair: ComparePair[] = [
  { a: "doc-ghost", b: "doc-rs26", relation: "conflicting", related: 0.98, conflicts: [] },
];
const ghostPairSanitized = sanitizeCompare(ghostPair, [0], docMap);
check("pair with an unknown document is dropped whole", ghostPairSanitized.pairs.length === 0);
check(
  "its conflict index disappears with it (no stale remap)",
  ghostPairSanitized.conflictIndexes.length === 0,
  ghostPairSanitized.conflictIndexes,
);
check(
  "an issue names the pair and the unknown document",
  ghostPairSanitized.issues[0]?.includes("doc-ghost") && ghostPairSanitized.issues[0]?.includes("pair"),
  ghostPairSanitized.issues,
);
check(
  "composed: a flagged pair between unknown documents is an integrity failure, not a source conflict",
  computeTriage(
    okInputs({ pairs: ghostPairSanitized.pairs, conflictIndexes: ghostPairSanitized.conflictIndexes, integrityIssues: ghostPairSanitized.issues }),
  ).state === "review_required",
);

const findingOnGhostSide = {
  a: { document: "doc-sp21", quote: "q", start: 0, end: 10 },
  b: { document: "doc-ghost", quote: "q", start: 0, end: 10 },
};
const keptPair = sanitizeCompare(
  [
    {
      a: "doc-sp21",
      b: "doc-rs26",
      relation: "conflicting",
      related: 0.98,
      conflicts: [findingOnGhostSide, { a: { document: "doc-sp21", quote: "q1", start: 0, end: 10 }, b: { document: "doc-rs26", quote: "q2", start: 0, end: 10 } }],
    },
  ],
  [0],
  docMap,
);
check("the pair itself is kept when its documents are submitted", keptPair.pairs.length === 1);
check(
  "the finding citing a ghost document is dropped, the sound one stays",
  keptPair.pairs[0].conflicts?.length === 1,
  keptPair.pairs[0].conflicts,
);
check("an issue records the dropped finding", keptPair.issues.length === 1, keptPair.issues);

const mismatchedSide = sanitizeCompare(
  [
    {
      a: "doc-sp21",
      b: "doc-rs26",
      relation: "conflicting",
      related: 0.98,
      conflicts: [{ a: { document: "doc-rs26", quote: "q", start: 0, end: 10 } }], // valid doc, wrong side
    },
  ],
  [],
  docMap,
);
check(
  "a finding side citing the OTHER side's document is dropped (no mis-attribution)",
  mismatchedSide.pairs[0].conflicts?.length === 0 && mismatchedSide.issues[0]?.includes("not the document on that side"),
  mismatchedSide.issues,
);

const outOfBoundsFinding = sanitizeCompare(
  [
    {
      a: "doc-sp21",
      b: "doc-rs26",
      relation: "conflicting",
      related: 0.98,
      conflicts: [{ a: { document: "doc-sp21", quote: "q", start: 0, end: docSp21.text.length + 1 } }],
    },
  ],
  [],
  docMap,
);
check(
  "finding offsets beyond the document are dropped",
  outOfBoundsFinding.pairs[0].conflicts?.length === 0 &&
    outOfBoundsFinding.issues[0]?.includes("characters long"),
  outOfBoundsFinding.issues,
);

const remap = sanitizeCompare(
  [
    { a: "doc-ghost", b: "doc-rs26", relation: "conflicting", related: 0.9 }, // dropped
    { a: "doc-sp21", b: "doc-rs26", relation: "conflicting", related: 0.98 }, // kept -> 0
    { a: "doc-rs26", b: "doc-sp21", relation: "unrelated", related: 0.1 }, // kept -> 1
  ],
  [0, 2],
  docMap,
);
check(
  "conflict indexes are remapped to the kept pairs (0,2 -> 1)",
  remap.pairs.length === 2 &&
    remap.conflictIndexes.length === 1 &&
    remap.conflictIndexes[0] === 1 &&
    remap.pairs[1].a === "doc-rs26",
  { pairs: remap.pairs.length, conflictIndexes: remap.conflictIndexes },
);

const validConflict: ComparePair[] = [
  {
    a: "doc-sp21",
    b: "doc-rs26",
    relation: "conflicting",
    related: 0.98,
    conflicts: [
      {
        a: { document: "doc-sp21", quote: "Northwind retains customer audit logs for 12 months", start: 0, end: 10 },
        b: { document: "doc-rs26", quote: "Customer audit logs are retained for 24 months", start: 0, end: 10 },
      },
    ],
  },
];
const validConflictSanitized = sanitizeCompare(validConflict, [0], docMap);
check(
  "a fully valid conflicting pair survives sanitization untouched",
  validConflictSanitized.pairs.length === 1 &&
    validConflictSanitized.pairs[0].conflicts?.length === 1 &&
    validConflictSanitized.conflictIndexes[0] === 0 &&
    validConflictSanitized.issues.length === 0,
  validConflictSanitized,
);
check(
  "the flagship behavior holds: a real conflict => conflict_needs_decision",
  computeTriage(
    okInputs({
      pairs: validConflictSanitized.pairs,
      conflictIndexes: validConflictSanitized.conflictIndexes,
      integrityIssues: validConflictSanitized.issues,
    }),
  ).state === "conflict_needs_decision",
);

console.log("5) The opposing-evidence join works on reference-checked data");

const contradicted: VerifyClaim = {
  claim: "Northwind retains customer audit logs for 12 months",
  supported: 0.02,
  contradicted: 0.96,
  not_stated: 0.01,
  not_a_claim: 0.01,
  verdict: "contradicted",
};
const opposing = findOpposingEvidence(
  contradicted,
  validConflictSanitized.pairs,
  [0],
  docMap,
);
check(
  "the contradicting side is still found after sanitization",
  opposing?.opposing?.docId === "doc-rs26" && opposing.claimSide?.docId === "doc-sp21",
  { opposing: opposing?.opposing?.docId, claimSide: opposing?.claimSide?.docId },
);
check(
  "nothing is joined from a dropped (ghost) pair",
  findOpposingEvidence(contradicted, ghostPairSanitized.pairs, [], docMap) === undefined,
);

console.log("6) The exported packet mirrors the withholding, not the evidence");

const withheldResult: AnalysisResult = {
  caseId: conflictCase.id,
  ranAt: new Date().toISOString(),
  triage: { state: "review_required", reasons: ["integrity"] },
  trace: [],
  rerank: { ok: true, results: [useResult(registry[0])] },
  verify: {
    ok: true,
    claims: [
      {
        ...supportedClaim("Claim A"),
        evidence: undefined,
        evidenceWithheld: 'it cites document "doc-ghost", which is not one of the submitted sources',
      },
      supportedClaim("Claim B"),
    ],
    answers_question: 0.9,
  },
  compare: { ok: true, pairs: overlappingPairs, conflictIndexes: [] },
};
const md = buildMarkdown(conflictCase, withheldResult);
const claim1 = md.slice(md.indexOf("### Claim #1"), md.indexOf("### Claim #2"));
check(
  "claim ledger says the evidence was withheld",
  claim1.includes("Evidence: withheld —") && claim1.includes("doc-ghost"),
  claim1,
);
check(
  "no evidence attribution line for the withheld claim",
  !claim1.includes("Evidence: “"),
  claim1,
);
check(
  "no enrichment quote dressed up as the claim's evidence either",
  !claim1.includes("No direct Verify evidence was returned"),
  claim1,
);
check(
  "a valid evidence reference still exports normally (control)",
  md.slice(md.indexOf("### Claim #2")).includes("Evidence: “"),
);

console.log("7) Transport failures keep their meaning alongside integrity issues");

const retryablePlusIntegrity = computeTriage(
  okInputs({
    verifyOk: false,
    verifyError: { code: "http_429", message: "grounding returned HTTP 429" },
    integrityIssues: ["Verify cited document \"doc-ghost\" ..."],
  }),
);
check(
  "a retryable endpoint failure stays analysis_incomplete (a retry may return clean references)",
  retryablePlusIntegrity.state === "analysis_incomplete",
  retryablePlusIntegrity.state,
);
const fatalPlusIntegrity = computeTriage(
  okInputs({
    verifyOk: false,
    verifyError: { code: "http_400", message: "grounding returned HTTP 400" },
    integrityIssues: ["Verify cited document \"doc-ghost\" ..."],
  }),
);
check(
  "a non-retryable failure shows both the endpoint error and the integrity issue",
  fatalPlusIntegrity.state === "review_required" &&
    fatalPlusIntegrity.reasons.some((r) => r.includes("http_400")) &&
    fatalPlusIntegrity.reasons.some((r) => r.includes("doc-ghost")),
  fatalPlusIntegrity.reasons,
);

console.log("8) The five saved live runs (run6) pass the new gates with no false positives");

// Replay every saved live result through the same composition the route now
// performs: re-join the Rerank results, reference-check Verify evidence and
// Compare pairs/findings, and recompute the triage. Real endpoint outputs must
// produce zero integrity issues, unchanged evidence, and the exact documented
// state of each demo case.
import { readFileSync } from "fs";
import type { AnalysisResult as SavedResult } from "../src/lib/analysis";

for (const file of [
  "run6-supported.json",
  "run6-conflict.json",
  "run6-missing.json",
  "run6-scope-trap.json",
  "run6-wrong-question.json",
]) {
  const saved = JSON.parse(readFileSync(`tool-results/${file}`, "utf8")) as SavedResult;
  const demoCase = getCase(saved.caseId);
  if (!demoCase) {
    check(`${file}: case ${saved.caseId} exists`, false);
    continue;
  }
  const savedDocMap = Object.fromEntries(
    demoCase.docs.map((d) => [d.id, { title: d.title, text: d.text }]),
  );
  const savedRegistry = buildRegistry(demoCase.docs);

  // Rerank: the strict join must reproduce the passages the live run joined.
  const rejoined = saved.rerank.results.map((r) => ({
    ...r,
    passage: joinResultToPassage({ id: r.id, index: r.index }, savedRegistry, savedRegistry),
  }));
  const joinsMatch = rejoined.every(
    (r, i) => (r.passage?.id ?? undefined) === (saved.rerank.results[i].passage?.id ?? undefined),
  );

  // Verify: no real evidence reference may be flagged.
  const verifyCheck = sanitizeVerifyClaims(
    saved.verify.claims.map(({ closest: _c, opposing: _o, ...claim }) => claim as VerifyClaim),
    savedDocMap,
  );
  const evidenceKept = verifyCheck.claims.every(
    (c, i) =>
      JSON.stringify(c.evidence ?? null) ===
        JSON.stringify(saved.verify.claims[i].evidence ?? null) &&
      c.evidenceWithheld === undefined,
  );

  // Compare: no real pair or finding may be dropped, and the conflict indexes
  // survive the remap unchanged (identity when nothing is dropped).
  const compareCheck = sanitizeCompare(
    saved.compare.pairs,
    saved.compare.conflictIndexes,
    savedDocMap,
  );
  const pairsKept =
    compareCheck.pairs.length === saved.compare.pairs.length &&
    JSON.stringify(compareCheck.conflictIndexes) === JSON.stringify(saved.compare.conflictIndexes);

  const issues = verifyCheck.issues.length + compareCheck.issues.length;
  const replayed = computeTriage({
    rerankOk: saved.rerank.ok,
    rerankResults: rejoined,
    verifyOk: saved.verify.ok,
    claims: verifyCheck.claims,
    answersQuestion: saved.verify.answers_question,
    compareOk: saved.compare.ok,
    pairs: compareCheck.pairs,
    conflictIndexes: compareCheck.conflictIndexes,
    integrityIssues: [...verifyCheck.issues, ...compareCheck.issues],
  });

  check(
    `${file}: joins, evidence, and pairs all pass the reference checks (0 issues)`,
    joinsMatch && evidenceKept && pairsKept && issues === 0,
    { joinsMatch, evidenceKept, pairsKept, issues },
  );
  check(
    `${file}: recomputed state is the documented "${saved.triage.state}"`,
    replayed.state === saved.triage.state,
    { replayed: replayed.state, saved: saved.triage.state },
  );
}

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
