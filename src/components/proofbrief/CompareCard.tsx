// ProofBrief — Compare results: pairwise relations between the source documents.

import type { AnalysisResult } from "@/lib/analysis";
import type { SourceDoc } from "@/lib/cases";
import { sectionContextFor, resolveQuote } from "@/lib/registry";
import { compareRelationMeta, formatProb } from "@/lib/display";
import { ScoreBar } from "./ScoreBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitCompareArrows } from "lucide-react";

export function CompareCard({
  compare,
  docTitles,
  docs,
}: {
  compare: AnalysisResult["compare"];
  docTitles: Record<string, string>;
  docs: Record<string, SourceDoc>;
}) {
  const titleFor = (id: string) => docTitles[id] ?? id;
  // Endpoint quotes are verbatim extractions and can be as short as a heading;
  // look up the surrounding source section by character offsets so a short
  // extraction can be read in context. Uses only the supplied documents.
  const contextFor = (docId: string | undefined, start?: number, end?: number) => {
    if (!docId || !docs[docId]) return undefined;
    return sectionContextFor(docs[docId].text, start, end);
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompareArrows className="h-4 w-4 text-teal-700" aria-hidden="true" />
            Source cross-check
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-800">
              Clocked Compare
            </Badge>
            {compare.model && (
              <span className="font-mono text-[10px] text-muted-foreground">{compare.model}</span>
            )}
          </div>
        </div>
        <CardDescription>
          Every pair of source documents, with paired passages for duplicates and conflicts. A
          differing number alone is not a contradiction: same entity, period, and scope are required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!compare.ok && compare.error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Compare could not complete ({compare.error.code}): {compare.error.message}
          </p>
        )}
        {compare.ok && compare.pairs.length === 0 && (
          <p className="text-sm text-muted-foreground">Compare returned no pairs.</p>
        )}
        {compare.pairs.map((pair, i) => {
          const meta = compareRelationMeta(pair.relation);
          const isConflict = pair.relation === "conflicting" || compare.conflictIndexes.includes(i);
          return (
            <article
              key={i}
              id={`compare-pair-${i}`}
              className={`scroll-mt-4 rounded-md border p-3 ${isConflict ? "border-rose-300 bg-rose-50/40" : "border-border bg-card"}`}
              aria-label={`Pair ${titleFor(pair.a)} and ${titleFor(pair.b)}: ${meta.label}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {titleFor(pair.a)} <span aria-hidden="true">↔</span> {titleFor(pair.b)}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                  {meta.label}
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  pair index {i}
                </span>
              </div>
              <div className="mt-2">
                <ScoreBar
                  value={pair.related}
                  label="related probability"
                  tone={isConflict ? "rose" : "teal"}
                />
              </div>
              {(pair.conflicts ?? []).length > 0 && (
                <div className="mt-2 space-y-2" aria-label="Conflict findings">
                  {(pair.conflicts ?? []).map((f, j) => {
                    // Endpoint quotes are verbatim extractions and can be as
                    // short as a bare heading. Resolve each against its source
                    // document: display the passage body (heading markers
                    // stripped) or, for a heading-only extraction, the full
                    // section located by the endpoint's own offsets. The raw
                    // extraction and its offsets stay visible either way.
                    const aRes = f.a
                      ? resolveQuote(docs[f.a.document]?.text, f.a.quote, f.a.start, f.a.end)
                      : undefined;
                    const bRes = f.b
                      ? resolveQuote(docs[f.b.document]?.text, f.b.quote, f.b.start, f.b.end)
                      : undefined;
                    const aCtx = f.a ? contextFor(f.a.document, f.a.start, f.a.end) : undefined;
                    const bCtx = f.b ? contextFor(f.b.document, f.b.start, f.b.end) : undefined;
                    return (
                    <div key={j} className="rounded-md border border-rose-200 bg-rose-50 p-2.5">
                      <p className="mb-1.5 text-xs font-semibold text-rose-900">
                        Conflict finding {j + 1}
                        {f.kind ? ` · kind: ${f.kind}` : ""}
                        {f.confidence !== undefined ? ` · confidence ${formatProb(f.confidence)}` : ""}
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {f.a && aRes && (
                          <blockquote className="border-l-2 border-rose-300 pl-3 text-xs leading-relaxed text-foreground/85">
                            “{aRes.display}”
                            <footer className="mt-1 text-muted-foreground">
                              {titleFor(f.a.document)} · chars {f.a.start}–{f.a.end}
                            </footer>
                            {aRes.expanded && (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Endpoint extraction was the section heading only: “{aRes.raw}” — the
                                passage above is its full section from the source document.
                              </p>
                            )}
                            {!aRes.expanded && aCtx && aCtx.trim() !== f.a.quote.trim() && (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
                                  Section context from {titleFor(f.a.document)}
                                </summary>
                                <p className="mt-1 whitespace-pre-wrap rounded bg-card/70 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                                  {aCtx}
                                </p>
                              </details>
                            )}
                          </blockquote>
                        )}
                        {f.b && bRes && (
                          <blockquote className="border-l-2 border-rose-300 pl-3 text-xs leading-relaxed text-foreground/85">
                            “{bRes.display}”
                            <footer className="mt-1 text-muted-foreground">
                              {titleFor(f.b.document)} · chars {f.b.start}–{f.b.end}
                            </footer>
                            {bRes.expanded && (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Endpoint extraction was the section heading only: “{bRes.raw}” — the
                                passage above is its full section from the source document.
                              </p>
                            )}
                            {!bRes.expanded && bCtx && bCtx.trim() !== f.b.quote.trim() && (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
                                  Section context from {titleFor(f.b.document)}
                                </summary>
                                <p className="mt-1 whitespace-pre-wrap rounded bg-card/70 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                                  {bCtx}
                                </p>
                              </details>
                            )}
                          </blockquote>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">
                    A human decides whether one document should be retired or the scope clarified.
                    ProofBrief blocks approval until then.
                  </p>
                </div>
              )}
              {(pair.conflicts ?? []).length === 0 && pair.relation !== "unrelated" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No conflict findings for this pair.
                  {pair.relation === "same" || pair.relation === "overlapping"
                    ? " The documents agree or overlap on shared content."
                    : ""}
                </p>
              )}
              {(pair.duplicates ?? []).length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    {(pair.duplicates ?? []).length} duplicate finding
                    {(pair.duplicates ?? []).length > 1 ? "s" : ""} (paired passages)
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    {(pair.duplicates ?? []).map((f, j) => (
                      <p key={j} className="text-xs text-muted-foreground">
                        {f.kind ? `kind: ${f.kind}` : "duplicate"} — “{(f.a?.quote ?? "").slice(0, 90)}…” ≈ “{(f.b?.quote ?? "").slice(0, 90)}…”
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </article>
          );
        })}
        {compare.ok && compare.verdict && (
          <p className="text-xs text-muted-foreground">Endpoint roll-up verdict: {compare.verdict}</p>
        )}
      </CardContent>
    </Card>
  );
}
