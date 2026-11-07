// ProofBrief — offline check for the Markdown export fix.
// Runs against the REAL endpoint outputs saved in tool-results/run4-conflict.json
// (from the 2026-11-07 live rerun after the export fix) — no further API calls,
// fully deterministic. It builds the actual exported packet (src/lib/export.ts,
// the same module the UI's export button uses) and asserts the "Source
// cross-check" section resolves quotes exactly like the UI does.
//
//   bun scripts/check-export-fix.ts
import { readFileSync } from "fs";
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

const run = JSON.parse(readFileSync("tool-results/run4-conflict.json", "utf8")) as AnalysisResult;
const demoCase = getCase("conflict")!;
const md = buildMarkdown(demoCase, run);

const crossStart = md.indexOf("## Source cross-check (Clocked Compare)");
const crossEnd = md.indexOf("## Passage shortlist (Clocked Rerank)");
const crossCheck = md.slice(crossStart, crossEnd);
const ledger = md.slice(md.indexOf("## Claim ledger (Clocked Verify)"), crossStart);

console.log("1) Source cross-check — heading-only extraction exported as its full section");
check("section present", crossStart !== -1 && crossEnd > crossStart);
check(
  "doc-sp21 side shows the 12-month section body, not just the heading",
  crossCheck.includes("Northwind retains customer audit logs for 12 months from the date of record"),
  crossCheck,
);
check(
  "raw heading kept only inside the attribution note, with its raw-extraction offsets",
  crossCheck.includes('endpoint extraction was the section heading only (“## Audit log retention”, chars 186–208)'),
  crossCheck,
);
check(
  "offsets do not sit next to the displayed full section",
  !crossCheck.includes("chars 186–208: “"),
  crossCheck,
);
check(
  "doc-rs26 side shows the 24-month passage with heading line stripped",
  crossCheck.includes("Audit log records are retained for 24 months from the date of record, then deleted."),
  crossCheck,
);

console.log("2) No heading is ever displayed as a quote anywhere in the packet");
check(
  'no “: “## …” display pattern (a displayed quote starting with a heading marker)',
  !md.includes(": “## "),
  md.split("\n").filter((l) => l.includes(": “## ")),
);

console.log("3) Claim ledger regression guard — opposing 24-month passage still exported");
check("ledger carries the opposing passage label", ledger.includes("Opposing passage"));
check(
  "ledger carries the 24-month passage",
  ledger.includes("Audit log records are retained for 24 months"),
  ledger,
);
check(
  "ledger attributes the claim to doc-sp21 (12-month policy)",
  ledger.includes("The claim’s wording is closest to Security Policy v2.1 (doc-sp21)."),
  ledger,
);

console.log("4) Packet structure intact");
for (const section of [
  "# ProofBrief evidence packet",
  "## Customer question",
  "## Draft reply under review",
  "## Review state reasons",
  "## Claim ledger (Clocked Verify)",
  "## Source cross-check (Clocked Compare)",
  "## Passage shortlist (Clocked Rerank)",
  "## Endpoint trace (live Clocked calls)",
]) {
  check(`has “${section}”`, md.includes(section));
}

console.log("");
console.log("---- Source cross-check section as exported ----");
console.log(crossCheck.trim());
console.log("------------------------------------------------");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
