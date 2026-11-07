// ProofBrief — Verify results: the claim ledger. The heart of the screen.
//
// Display rules:
// - A contradicted claim leads with the opposing passage of the flagged
//   Compare pair (the reason the claim conflicts), then shows Verify's own
//   evidence extraction. Both are live endpoint outputs, each labeled.
// - A claim with no Verify evidence quote is never left bare: for supported
//   claims the top `use` passage from the claim-level Rerank lookup is shown
//   as a quote, clearly labeled as a relevance match, not Verify evidence.

import type { AnalysisResult, PairSide } from "@/lib/analysis";
import { stripHeadingLine } from "@/lib/registry";
import { claimVerdictMeta, formatProb } from "@/lib/display";
import { ScoreBar } from "./ScoreBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileSearch } from "lucide-react";

function SideQuotes({ side }: { side: PairSide }) {
  if (side.quotes.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-foreground/80">
        {side.docTitle} ({side.docId}) is flagged in this pair but came back without a paired
        quote.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {side.quotes.map((q, j) => (
        <li key={j} className="text-xs leading-relaxed text-foreground/85">
          “{q.quote}”
          <span className="text-muted-foreground">
            {" "}— {side.docTitle} ({side.docId})
            {!q.expanded && q.start !== undefined && q.end !== undefined ? ` · chars ${q.start}–${q.end}` : ""}
          </span>
          {q.expanded && (
            <span className="block text-[10px] text-muted-foreground">
              Endpoint extraction was the section heading only: “{q.raw}”
              {q.start !== undefined && q.end !== undefined ? ` (chars ${q.start}–${q.end})` : ""} —
              the passage above is its full section from the source document.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

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
          const contradicted = c.verdict === "contradicted";
          // Claim-level quote for a supported claim that Verify left without an
          // evidence quote: the top `use` passage of the claim-level Rerank
          // lookup, shown as a quote but labeled as what it is. Never used when
          // the evidence was withheld for failing the reference check.
          const closestUse =
            !c.evidence &&
            !c.evidenceWithheld &&
            c.verdict !== "not_stated" &&
            c.verdict !== "not_a_claim"
              ? c.closest?.find((r) => r.action === "use" && r.passage)
              : undefined;
          const otherClosest = closestUse
            ? (c.closest ?? []).filter((r) => r !== closestUse)
            : c.closest;
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
              {opp && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50/60 p-2.5">
                  {!opp.indeterminate && opp.opposing ? (
                    <>
                      <p className="mb-1.5 text-xs font-semibold text-rose-900">
                        Opposing passage — the other side of the flagged source pair (Clocked
                        Compare, not Verify evidence):
                      </p>
                      <SideQuotes side={opp.opposing} />
                      {opp.claimSide && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-rose-900/80">
                          The claim’s wording is closest to {opp.claimSide.docTitle} (
                          {opp.claimSide.docId}); the passage above is from{" "}
                          {opp.opposing.docTitle} ({opp.opposing.docId}), the other document of the
                          flagged pair.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-1.5 text-xs font-semibold text-rose-900">
                        Both sides of the flagged source pair (Clocked Compare, not Verify
                        evidence) — the claim’s side could not be told apart by wording:
                      </p>
                      <div className="space-y-2">
                        {opp.sides.map((s, k) => (
                          <div key={s.docId + k}>
                            <p className="text-[11px] font-medium text-rose-900/90">
                              {s.docTitle} ({s.docId}):
                            </p>
                            <SideQuotes side={s} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <a
                    href={`#compare-pair-${opp.pairIndex}`}
                    className="mt-1.5 inline-block text-[10px] text-rose-800 underline decoration-dotted hover:text-rose-900"
                  >
                    See the full cross-check pair ↩
                  </a>
                </div>
              )}
              {c.evidence ? (
                <blockquote className="mt-2 border-l-2 border-teal-300 bg-teal-50/50 pl-3 text-sm leading-relaxed text-foreground/85">
                  {contradicted && (
                    <p className="mb-1 text-[11px] font-medium text-teal-900">
                      Verify evidence extraction for this claim:
                    </p>
                  )}
                  “{c.evidence.quote}”
                  <footer className="mt-1 text-xs text-muted-foreground">
                    {titleFor(c.evidence.document)} · chars {c.evidence.start}–{c.evidence.end} ·
                    confidence {formatProb(c.evidence.confidence)}
                  </footer>
                </blockquote>
              ) : c.evidenceWithheld ? (
                <p className="mt-2 rounded-md border border-dashed border-amber-400 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  Evidence withheld — Verify returned an evidence reference for this claim that
                  does not match the submitted documents ({c.evidenceWithheld}); it is not shown
                  as evidence. The review state fails closed on this.
                </p>
              ) : closestUse && closestUse.passage ? (
                <blockquote className="mt-2 border-l-2 border-teal-300 bg-teal-50/50 pl-3 text-sm leading-relaxed text-foreground/85">
                  <p className="mb-1 text-[11px] font-medium text-teal-900">
                    No direct Verify evidence was returned for this claim. Closest source passage
                    (Clocked Rerank relevance match — enrichment, not proof):
                  </p>
                  “{stripHeadingLine(closestUse.passage.text).trim()}”
                  <footer className="mt-1 text-xs text-muted-foreground">
                    {closestUse.passage.docTitle} — section “{closestUse.passage.section}” ·
                    passage {closestUse.passage.id} · relevance{" "}
                    {formatProb(closestUse.relevance_score)} · action {closestUse.action}
                  </footer>
                </blockquote>
              ) : (
                <p className="mt-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Evidence passage not returned for this claim. Evidence is optional even when
                  requested; no passage is invented when one is absent.
                </p>
              )}
              {closestUse && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  Enrichment only: this passage is the top relevance match for the claim, not
                  Verify evidence. The verdict and the review state are exactly what the endpoints
                  returned.
                </p>
              )}
              {otherClosest && otherClosest.length > 0 && (
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
                      : closestUse
                        ? "Other nearest sources by relevance (Clocked Rerank):"
                        : "No evidence quote was returned. Nearest sources by relevance (Clocked Rerank):"}
                  </p>
                  <ul className="space-y-1.5">
                    {otherClosest.map((r, j) => (
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
