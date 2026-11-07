// ProofBrief — offline checks for the evidence-display fixes.
// Runs against the REAL endpoint outputs saved in tool-results/run2-conflict.json
// (from the 2026-11-07 live run) — no API calls, fully deterministic.
//
//   bun scripts/check-display-fixes.ts
import { readFileSync } from "fs";
import { resolveQuote, stripHeadingLine, buildRegistry } from "../src/lib/registry";
import { findOpposingEvidence } from "../src/lib/analysis";
import { getCase } from "../src/lib/cases";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const run = JSON.parse(readFileSync("tool-results/run2-conflict.json", "utf8"));
const demoCase = getCase("conflict")!;
const docMap = Object.fromEntries(
  demoCase.docs.map((d) => [d.id, { title: d.title, text: d.text }]),
);

console.log("1) resolveQuote — heading-only extraction expands to its full section");
const aQuote = run.compare.pairs[0].conflicts[0].a; // "## Audit log retention" (doc-sp21)
const aRes = resolveQuote(docMap[aQuote.document].text, aQuote.quote, aQuote.start, aQuote.end);
check("marked expanded", aRes.expanded === true);
check("raw extraction preserved", aRes.raw === "## Audit log retention", aRes.raw);
check(
  "display is the 12-month passage body, not the heading",
  aRes.display.startsWith("Northwind retains customer audit logs for 12 months"),
  aRes.display,
);
check("display carries no heading marker", !aRes.display.includes("## "), aRes.display);

console.log("2) resolveQuote — heading-line prefix stripped, body kept verbatim");
const bQuote = run.compare.pairs[0].conflicts[0].b; // "## Audit records\nAudit log records ... 24 months ..."
const bRes = resolveQuote(docMap[bQuote.document].text, bQuote.quote, bQuote.start, bQuote.end);
check("not expanded", bRes.expanded === false);
check("heading line stripped from display", !bRes.display.startsWith("## "), bRes.display);
check(
  "body kept — the 24-month sentence",
  bRes.display.startsWith("Audit log records are retained for 24 months"),
  bRes.display,
);

console.log("3) resolveQuote — substantive quote passes through unchanged");
const ev = run.verify.claims[0].evidence;
const evRes = resolveQuote(docMap[ev.document].text, ev.quote, ev.start, ev.end);
check("not expanded", evRes.expanded === false);
check("display identical to endpoint quote", evRes.display === ev.quote, evRes.display);

console.log("4) findOpposingEvidence — the 24-month document is the opposing side");
const claim = run.verify.claims[0];
const opp = findOpposingEvidence(claim, run.compare.pairs, run.compare.conflictIndexes, docMap);
check("join returned", Boolean(opp));
check("determined (not indeterminate)", opp?.indeterminate === false);
check(
  "opposing doc is doc-rs26 (Retention Schedule 2026, 24 months)",
  opp?.opposing?.docId === "doc-rs26",
  opp?.opposing?.docId,
);
check("claim side is doc-sp21 (Security Policy, 12 months)", opp?.claimSide?.docId === "doc-sp21", opp?.claimSide?.docId);
check(
  "opposing quote is the 24-month passage with heading stripped",
  Boolean(opp?.opposing?.quotes[0]?.quote.startsWith("Audit log records are retained for 24 months")),
  opp?.opposing?.quotes[0]?.quote,
);
check("raw extraction preserved on the opposing quote", opp?.opposing?.quotes[0]?.raw === bQuote.quote);
check("both sides carried for the pair card link", (opp?.sides?.length ?? 0) === 2);

console.log("5) findOpposingEvidence — robust when Verify cites the contradicting document");
// Same claim, but simulate the run-to-run variance where Verify's evidence for
// the contradicted claim points at the 24-month passage instead of doc-sp21.
const flippedEvidence = {
  ...claim,
  evidence: { document: "doc-rs26", quote: bQuote.quote, start: bQuote.start, end: bQuote.end, confidence: 0.9 },
};
const opp2 = findOpposingEvidence(flippedEvidence, run.compare.pairs, run.compare.conflictIndexes, docMap);
check(
  "opposing is still doc-rs26 — the passage that disagrees with the 12-month claim",
  opp2?.opposing?.docId === "doc-rs26",
  opp2?.opposing?.docId,
);
check("claim side still doc-sp21", opp2?.claimSide?.docId === "doc-sp21", opp2?.claimSide?.docId);

console.log("6) scope-trap — supported claim's top use passage displays as passage body");
const registry = buildRegistry(getCase("scope-trap")!.docs);
const backup = registry.find((p) => p.id === "doc-brs20-s1");
check("registry passage found", Boolean(backup));
check(
  "heading stripped — quote starts with the 7-year sentence",
  stripHeadingLine(backup!.text).trim().startsWith("Full backup archives are retained for 7 years"),
  stripHeadingLine(backup!.text).slice(0, 60),
);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
