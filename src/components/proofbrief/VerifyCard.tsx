// ProofBrief — Verify results: the claim ledger. The heart of the screen.

import type { AnalysisResult } from "@/lib/analysis";
import { claimVerdictMeta, formatProb } from "@/lib/display";
import { ScoreBar } from "./ScoreBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileSearch } from "lucide-react";

export function VerifyCard({ verify, docTitles }: { verify: AnalysisResult["verify"]; docTitles: Record<string, string> }) {
  const titleFor = (id: string | undefined | null) =>
    (id && docTitles[id]) || id || "unknown document";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSearch className="h-4 w-4 text-teal-700" aria-hidden="true" />
            Claim ledger
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-800">
              Clocked Verify
            </Badge>
            {verify.model && (
              <span className="font-mono text-[10px] text-muted-foreground">{verify.model}</span>
            )}
          </div>
        </div>
        <CardDescription>
          Each claim of the draft, judged against the supplied sources. Verdicts describe support in
          these documents, not truth in the outside world.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!verify.ok && verify.error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Verify could not complete ({verify.error.code}): {verify.error.message}
          </p>
        )}
        {verify.ok && (
          <div className="grid gap-1.5 rounded-md border border-border bg-muted/40 p-3">
            <ScoreBar value={verify.grounded} label="grounded (aggregate)" tone="emerald" />
            <ScoreBar value={verify.answers_question} label="answers question" tone="teal" />
            {verify.threshold !== undefined && (
              <p className="text-xs text-muted-foreground">threshold applied: {verify.threshold}</p>
            )}
          </div>
        )}
        {verify.claims.map((c, i) => {
          const meta = claimVerdictMeta(c.verdict);
          const opp = c.opposing;
          return (
            <article
              key={i}
              className="rounded-md border border-border bg-card p-3"
              aria-label={`Claim ${i + 1}: ${meta.label}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{i + 1}</span>
                  {c.claim}
                </p>
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                  {meta.label}
                </span>
              </div>
              <div className="mt-2 grid gap-1.5">
                <ScoreBar value={c.supported} label="supported" tone="emerald" />
                <ScoreBar value={c.contradicted} label="contradicted" tone="rose" />
                <ScoreBar value={c.not_stated} label="not_stated" tone="amber" />
              </div>
              {c.evidence ? (
                <blockquote className="mt-2 border-l-2 border-teal-300 bg-teal-50/50 pl-3 text-sm leading-relaxed text-foreground/85">
                  “{c.evidence.quote}”
                  <footer className="mt-1 text-xs text-muted-foreground">
                    {titleFor(c.evidence.document)} · chars {c.evidence.start}–{c.evidence.end} ·
                    confidence {formatProb(c.evidence.confidence)}
                  </footer>
                </blockquote>
              ) : (
                <p className="mt-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Evidence passage not returned for this claim. Evidence is optional even when
                  requested; no passage is invented when one is absent.
                </p>
              )}
              {opp && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50/60 p-2.5">
                  <p className="mb-1.5 text-xs font-semibold text-rose-900">
                    Opposing passage — from the flagged source pair (Clocked Compare, not Verify
                    evidence):
                  </p>
                  {opp.quotes.length > 0 ? (
                    <ul className="space-y-1.5">
                      {opp.quotes.map((q, j) => (
                        <li key={j} className="text-xs leading-relaxed text-foreground/85">
                          “{q.quote}”
                          <span className="text-muted-foreground">
                            {" "}— {opp.docTitle} ({opp.docId})
                            {q.start !== undefined && q.end !== undefined
                              ? ` · chars ${q.start}–${q.end}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs leading-relaxed text-foreground/80">
                      {opp.docTitle} is flagged conflicting with the claim’s evidence document, but
                      the pair came back without a paired quote. See the cross-check below.
                    </p>
                  )}
                  <a
                    href={`#compare-pair-${opp.pairIndex}`}
                    className="mt-1.5 inline-block text-[10px] text-rose-800 underline decoration-dotted hover:text-rose-900"
                  >
                    See the full cross-check pair ↩
                  </a>
                </div>
              )}
              {c.closest && c.closest.length > 0 && (
                <div
                  className={`mt-2 rounded-md border p-2.5 ${
                    c.verdict === "not_stated"
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-teal-200 bg-teal-50/60"
                  }`}
                >
                  <p
                    className={`mb-1.5 text-xs font-semibold ${
                      c.verdict === "not_stated" ? "text-amber-900" : "text-teal-900"
                    }`}
                  >
                    {c.verdict === "not_stated"
                      ? "Nearest sources for this claim (Clocked Rerank) — what the documents do say:"
                      : "No evidence quote was returned. Nearest sources by relevance (Clocked Rerank):"}
                  </p>
                  <ul className="space-y-1.5">
                    {c.closest.map((r, j) => (
                      <li
                        key={r.passage?.id ?? j}
                        className="text-xs leading-relaxed text-foreground/85"
                      >
                        <span className="font-mono text-muted-foreground">{r.passage?.id ?? r.index}</span>{" "}
                        <span className="font-medium">
                          {r.action}
                          {r.reason ? ` (${r.reason.replace(/_/g, " ")})` : ""}
                        </span>
                        {r.passage && (
                          <>
                            {" — “"}
                            {r.passage.text.length > 170
                              ? r.passage.text.slice(0, 170) + "…"
                              : r.passage.text}
                            {"”"}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {c.verdict === "not_stated"
                      ? "Enrichment only: these passages did not establish the claim. They are the closest the supplied sources come to it, so a reviewer can see the gap."
                      : "Enrichment only: these passages are ranked by relevance to the claim. They are not Verify evidence, and they do not change the verdict or the review state."}
                  </p>
                </div>
              )}
            </article>
          );
        })}
        {verify.ok && verify.claims.length === 0 && (
          <p className="text-sm text-muted-foreground">Verify returned no claims.</p>
        )}
      </CardContent>
    </Card>
  );
}
