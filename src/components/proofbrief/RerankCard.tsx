// ProofBrief — Rerank results: passage shortlist joined back to the registry.

import type { AnalysisResult } from "@/lib/analysis";
import { rerankActionMeta } from "@/lib/display";
import { ScoreBar } from "./ScoreBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListFilter } from "lucide-react";

export function RerankCard({ rerank }: { rerank: AnalysisResult["rerank"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListFilter className="h-4 w-4 text-teal-700" aria-hidden="true" />
            Passage shortlist
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-800">
              Clocked Rerank
            </Badge>
            {rerank.model && (
              <span className="font-mono text-[10px] text-muted-foreground">{rerank.model}</span>
            )}
          </div>
        </div>
        <CardDescription>
          Every source passage read against the question. Results carry no text, so each id is joined
          back to the registry excerpt below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rerank.ok && rerank.error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Rerank could not complete ({rerank.error.code}): {rerank.error.message}
          </p>
        )}
        {rerank.ok && rerank.results.length === 0 && (
          <p className="text-sm text-muted-foreground">Rerank returned no results.</p>
        )}
        {rerank.results.map((r, i) => {
          const meta = rerankActionMeta(r.action);
          return (
            <article
              key={r.passage?.id ?? i}
              className="rounded-md border border-border bg-card p-3"
              aria-label={`Passage ${r.passage?.id ?? i + 1}: ${meta.label}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {r.passage?.id ?? `index ${r.index}`}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
                  {meta.label}
                  {r.action === "skip" && r.reason ? `: ${r.reason.replace(/_/g, " ")}` : ""}
                </span>
                {r.passage && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.passage.docTitle} · {r.passage.section} · chars {r.passage.start}–{r.passage.end}
                  </span>
                )}
              </div>
              <blockquote className="mt-2 border-l-2 border-teal-300 pl-3 text-sm leading-relaxed text-foreground/85">
                {r.passage?.text ?? "Passage text unavailable: registry join failed for this id."}
              </blockquote>
              <div className="mt-2 grid gap-1.5">
                <ScoreBar value={r.relevance_score} label="relevance_score" tone="teal" />
                <ScoreBar value={r.document_score} label="document_score" tone="slate" />
              </div>
            </article>
          );
        })}
        {rerank.ok && rerank.results.some((r) => r.levels) && (
          <p className="text-xs text-muted-foreground">
            levels distribution returned per passage; close calls are visible in the raw JSON export.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          relevance_score: probability this passage answers the question · document_score: probability
          the answer is somewhere in its document.
        </p>
      </CardContent>
    </Card>
  );
}
