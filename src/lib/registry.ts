// ProofBrief — passage registry.
// Clocked Rerank returns results without passage text: "Join them back to your
// documents by index or id." This registry is that join layer: every passage
// sent to Rerank is recorded with its document, section, and character offsets,
// so results can be displayed with the exact source excerpt.

import type { SourceDoc } from "./cases";

export interface PassageEntry {
  /** Stable id sent to Rerank and echoed back in results. */
  id: string;
  docId: string;
  docTitle: string;
  section: string;
  text: string;
  /** Character offsets of this passage within its document's full text. */
  start: number;
  end: number;
}

/**
 * Split each document into passages at "## " section headings and record
 * character offsets by locating each section within the document text.
 */
export function buildRegistry(docs: SourceDoc[]): PassageEntry[] {
  const registry: PassageEntry[] = [];
  for (const doc of docs) {
    const lines = doc.text.split("\n");
    let cursor = 0;
    let current: { section: string; lines: string[] } | null = null;
    const sections: { section: string; lines: string[] }[] = [];
    for (const line of lines) {
      if (line.startsWith("## ")) {
        if (current) sections.push(current);
        current = { section: line.slice(3).trim(), lines: [line] };
      } else if (current) {
        current.lines.push(line);
      }
      cursor += line.length + 1;
    }
    if (current) sections.push(current);

    sections.forEach((sec, i) => {
      const text = sec.lines.join("\n").trim();
      const start = doc.text.indexOf(text);
      if (start === -1) return; // cannot happen for our synthetic docs
      registry.push({
        id: `${doc.id}-s${i + 1}`,
        docId: doc.id,
        docTitle: doc.title,
        section: sec.section,
        text,
        start,
        end: start + text.length,
      });
    });
  }
  return registry;
}

/** Rerank request documents built from registry entries. */
export function toRerankDocuments(registry: PassageEntry[]) {
  return registry.map((p) => ({
    id: p.id,
    text: p.text,
    title: `${p.docTitle} — ${p.section}`,
    metadata: { docId: p.docId, section: p.section, start: String(p.start), end: String(p.end) },
  }));
}

/** Join a Rerank result back to its registry entry by id, falling back to index. */
export function joinResultToPassage(
  result: { id?: string; index: number },
  registry: PassageEntry[],
  sentOrder: PassageEntry[],
): PassageEntry | undefined {
  if (result.id) {
    const byId = registry.find((p) => p.id === result.id);
    if (byId) return byId;
  }
  return sentOrder[result.index];
}

// ---- Quote display resolution ----
//
// Clocked Verify and Compare return verbatim extractions, and an extraction
// can be as thin as a bare section heading ("## Audit log retention") or start
// with a heading line. A heading is not evidence a reviewer can read. These
// helpers keep the endpoint's raw extraction (it is the record of what the
// endpoint said) while choosing what to display: the quote's body text, or —
// when the extraction carries no body — the surrounding source section located
// by the endpoint's own character offsets. Nothing outside the supplied
// documents is ever used.

export interface ResolvedQuote {
  /** Text to display: heading markers stripped; a heading-only extraction is
   *  replaced by its full source section. */
  display: string;
  /** The endpoint's exact extraction, kept for the attribution note. */
  raw: string;
  /** True when `display` substitutes the surrounding section for the raw
   *  extraction (raw was heading-only or empty). */
  expanded: boolean;
}

/** Remove a single leading "# …" heading line from a passage or quote. */
export function stripHeadingLine(text: string): string {
  const m = text.match(/^\s*#{1,6}\s+.+\r?\n/);
  return m ? text.slice(m[0].length) : text;
}

/**
 * True when the text carries no substantive body: empty, or a short run of
 * words with no digits and no sentence punctuation — i.e. a bare heading.
 */
export function isHeadingOnly(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  const withoutMarker = t.replace(/^#{1,6}\s+/, "");
  const words = withoutMarker.split(/\s+/).filter(Boolean).length;
  const hasPunctuation = /[.;:,]/.test(withoutMarker);
  const hasDigits = /\d/.test(withoutMarker);
  return words <= 10 && !hasPunctuation && !hasDigits;
}

const DISPLAY_CAP = 600;

/**
 * Resolve an endpoint extraction for display against its source document.
 * The raw extraction is always preserved; only the displayed text changes.
 */
export function resolveQuote(
  docText: string | undefined,
  quote: string,
  start?: number,
  end?: number,
): ResolvedQuote {
  const body = stripHeadingLine(quote).trim();
  if (!isHeadingOnly(body)) {
    return { display: body, raw: quote, expanded: false };
  }
  // Heading-only (or empty) extraction: show the surrounding source section,
  // located by the endpoint's own offsets in the supplied document.
  const section = docText ? sectionContextFor(docText, start, end) : undefined;
  if (section && !isHeadingOnly(section)) {
    const display = stripHeadingLine(section).trim();
    return {
      display: display.length > DISPLAY_CAP ? display.slice(0, DISPLAY_CAP) + "…" : display,
      raw: quote,
      expanded: true,
    };
  }
  return { display: quote.trim(), raw: quote, expanded: false };
}

/**
 * Return the section (delimited by "## " headings) of `docText` that contains
 * the given character range, or undefined when the range is not usable. Used
 * to show the surrounding section when an endpoint returns only a short
 * verbatim extraction — for example a bare section heading.
 */
export function sectionContextFor(
  docText: string,
  start?: number,
  end?: number,
): string | undefined {
  if (
    start === undefined ||
    end === undefined ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > docText.length ||
    start > end
  ) {
    return undefined;
  }
  const headingStart = docText.lastIndexOf("## ", start);
  const sectionStart = headingStart === -1 ? 0 : headingStart;
  let sectionEnd = docText.indexOf("\n## ", Math.max(end, start));
  if (sectionEnd === -1) sectionEnd = docText.length;
  const context = docText.slice(sectionStart, sectionEnd).trim();
  if (context.length === 0) return undefined;
  return context.length > 900 ? context.slice(0, 900) + "…" : context;
}
