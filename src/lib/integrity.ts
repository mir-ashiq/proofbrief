// ProofBrief — source-reference integrity.
//
// Every reference an endpoint makes must resolve inside the documents that
// were actually submitted to it: Verify evidence must cite a submitted
// document at offsets inside that document's text, and every Compare pair and
// finding must cite the pair's own documents, again within bounds. Anything
// else is an output we cannot anchor to a source, so it is WITHHELD — never
// displayed as trustworthy evidence — and recorded as an integrity issue,
// which fails the review state closed (review_required, never "ready").
//
// This is deliberately separate from src/lib/validate.ts: that module checks
// that a response matches the documented SHAPE (enums, 0–1 scores, integer
// offsets); this one checks that its REFERENCES point into the submitted
// documents. Both must pass before an output can be shown as evidence.

import type { VerifyClaim, ComparePair, CompareFinding } from "./clocked";

/** The submitted documents, by id — the only texts a reference may point at. */
export type DocRefs = Record<string, { title: string; text: string }>;

/**
 * A Verify claim after the reference check. `evidenceWithheld` is set when
 * Verify returned an evidence reference that does not match the submitted
 * documents: the evidence is removed from the claim (it must never render as
 * evidence) and the reason names what was wrong. `evidence` is then null.
 */
export type SanitizedClaim = VerifyClaim & { evidenceWithheld?: string };

/** True when [start, end] lies inside docText (integers, in order, in range). */
function offsetsWithin(docText: string, start: number, end: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= end &&
    end <= docText.length
  );
}

/**
 * Check every claim's evidence reference. A claim whose evidence cites an
 * unknown document, or offsets outside that document, keeps its verdict and
 * scores (they are what the endpoint said) but loses the evidence — a
 * reviewer must never read a quote attributed to a document that was not part
 * of the review. Claims without evidence are left untouched.
 */
export function sanitizeVerifyClaims(
  claims: VerifyClaim[],
  docs: DocRefs,
): { claims: SanitizedClaim[]; issues: string[] } {
  const issues: string[] = [];
  const checked = claims.map((c, i): SanitizedClaim => {
    const ev = c.evidence;
    if (!ev) return c;
    const doc = docs[ev.document];
    if (!doc) {
      issues.push(
        `Verify cited document "${ev.document}" as evidence for claim #${i + 1}, but that document is not one of the ${Object.keys(docs).length} sources submitted for this review; the evidence was withheld rather than displayed.`,
      );
      const { evidence: _withheld, ...rest } = c;
      return {
        ...rest,
        evidenceWithheld: `it cites document "${ev.document}", which is not one of the submitted sources`,
      };
    }
    if (!offsetsWithin(doc.text, ev.start, ev.end)) {
      issues.push(
        `Verify's evidence for claim #${i + 1} cites characters ${ev.start}–${ev.end} of "${ev.document}", which is ${doc.text.length} characters long; the evidence was withheld rather than displayed.`,
      );
      const { evidence: _withheld, ...rest } = c;
      return {
        ...rest,
        evidenceWithheld: `it cites characters ${ev.start}–${ev.end} of "${ev.document}", which is only ${doc.text.length} characters long`,
      };
    }
    return c;
  });
  return { claims: checked, issues };
}

/**
 * Why one side (a or b) of a Compare finding cannot be kept, or undefined
 * when the reference is sound. A finding side must cite exactly the document
 * of its own side of the pair (so the join cannot attribute a quote to the
 * wrong document), and its offsets must lie inside that document.
 */
function findingSideIssue(
  side: NonNullable<CompareFinding["a"]>,
  key: "a" | "b",
  pair: ComparePair,
  docs: DocRefs,
): string | undefined {
  if (side.document !== pair[key]) {
    return `A Compare finding for the pair "${pair.a}" ↔ "${pair.b}" cited "${side.document}" as its ${key}-side document, which is not the document on that side of the pair; the finding was withheld rather than displayed.`;
  }
  const doc = docs[side.document];
  if (!doc) {
    return `A Compare finding for the pair "${pair.a}" ↔ "${pair.b}" cited "${side.document}", which is not one of the submitted documents; the finding was withheld rather than displayed.`;
  }
  if (!offsetsWithin(doc.text, side.start, side.end)) {
    return `A Compare finding cites characters ${side.start}–${side.end} of "${side.document}", which is only ${doc.text.length} characters long; the finding was withheld rather than displayed.`;
  }
  return undefined;
}

/** Keep a finding only when every present side references the pair soundly. */
function findingValid(
  finding: CompareFinding,
  pair: ComparePair,
  docs: DocRefs,
  issues: string[],
): boolean {
  for (const key of ["a", "b"] as const) {
    const side = finding[key];
    if (!side) continue;
    const issue = findingSideIssue(side, key, pair, docs);
    if (issue) {
      issues.push(issue);
      return false;
    }
  }
  return true;
}

export interface SanitizedCompare {
  /** Pairs whose documents were both submitted, findings reference-checked. */
  pairs: ComparePair[];
  /**
   * The endpoint's conflict indexes (into the pairs it returned), remapped to
   * the kept pairs above. Indexes pointing at a dropped pair disappear.
   */
  conflictIndexes: number[];
  issues: string[];
}

/**
 * Check every pair and finding against the submitted documents. A pair
 * between documents that were not both submitted is dropped whole (it is not
 * a relation between this review's sources); a finding whose quote cannot be
 * anchored to its side's document is dropped from its (kept) pair. Dropping
 * shifts pair positions, so the endpoint's conflict indexes are remapped in
 * the same pass — callers never see a stale index.
 */
export function sanitizeCompare(
  pairs: ComparePair[],
  conflictIndexes: number[],
  docs: DocRefs,
): SanitizedCompare {
  const issues: string[] = [];
  const remap = new Map<number, number>();
  const kept: ComparePair[] = [];
  pairs.forEach((pair, i) => {
    const missingA = !docs[pair.a];
    const missingB = !docs[pair.b];
    if (missingA || missingB) {
      issues.push(
        `Compare returned a pair between "${pair.a}" and "${pair.b}", but ${missingA ? `"${pair.a}"` : `"${pair.b}"`} is not one of the submitted documents; the pair was withheld rather than displayed.`,
      );
      return;
    }
    const checkFindings = (list: CompareFinding[] | undefined) =>
      list?.filter((f) => findingValid(f, pair, docs, issues));
    kept.push({
      ...pair,
      conflicts: checkFindings(pair.conflicts),
      duplicates: checkFindings(pair.duplicates),
    });
    remap.set(i, kept.length - 1);
  });
  const conflictIndexesKept = conflictIndexes
    .filter((i) => Number.isInteger(i) && i >= 0 && i < pairs.length)
    .map((i) => remap.get(i))
    .filter((i): i is number => i !== undefined);
  return { pairs: kept, conflictIndexes: conflictIndexesKept, issues };
}
