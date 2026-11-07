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
