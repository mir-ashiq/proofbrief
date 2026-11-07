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
