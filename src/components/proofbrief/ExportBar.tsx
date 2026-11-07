// ProofBrief — evidence packet export. This is the end of the workflow:
// a human receives the packet and decides. Nothing is sent anywhere.

import type { DemoCase } from "@/lib/cases";
import type { AnalysisResult } from "@/lib/analysis";
import { claimVerdictMeta, compareRelationMeta } from "@/lib/display";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

function buildMarkdown(demoCase: DemoCase, result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push(`# ProofBrief evidence packet`);
  lines.push("");
  lines.push(`- Case: ${demoCase.name} (\`${demoCase.id}\`) — synthetic data`);
  lines.push(`- Generated: ${new Date(result.ranAt).toLocaleString()}`);
  lines.push(`- Review state: ${result.triage.state}`);
  lines.push("");
  lines.push(`## Customer question`);
  lines.push("");
  lines.push(demoCase.question);
  lines.push("");
  lines.push(`## Draft reply under review`);
  lines.push("");
  lines.push(demoCase.draft);
  lines.push("");
  lines.push(`## Review state reasons`);
  result.triage.reasons.forEach((r) => lines.push(`- ${r}`));
  lines.push("");
  lines.push(`## Claim ledger (Clocked Verify)`);
  result.verify.claims.forEach((c, i) => {
    const meta = claimVerdictMeta(c.verdict);
    lines.push("");
    lines.push(`### Claim #${i + 1} — ${meta.label}`);
    lines.push(`> ${c.claim}`);
    lines.push(`supported ${(c.supported * 100).toFixed(0)}% · contradicted ${(c.contradicted * 100).toFixed(0)}% · not_stated ${(c.not_stated * 100).toFixed(0)}%`);
    if (c.evidence) {
      lines.push(`Evidence: “${c.evidence.quote}” — ${c.evidence.document}, chars ${c.evidence.start}–${c.evidence.end}, confidence ${(c.evidence.confidence * 100).toFixed(0)}%`);
    } else {
      lines.push(`Evidence: none returned (evidence is optional even when requested)`);
    }
    if (c.closest && c.closest.length > 0) {
      lines.push(
        c.verdict === "not_stated"
          ? `Nearest sources (Clocked Rerank, enrichment only — these did not establish the claim):`
          : `Nearest sources by relevance (Clocked Rerank, display-only — Verify returned no evidence quote):`,
      );
      c.closest.forEach((r) => {
        lines.push(`  - \`${r.passage?.id ?? r.index}\` ${r.action}${r.reason ? ` (${r.reason})` : ""} — “${(r.passage?.text ?? "").slice(0, 160)}”`);
      });
    }
    const opp = c.opposing;
    if (opp) {
      lines.push(`Opposing passage — from the flagged source pair (Clocked Compare, pair index ${opp.pairIndex}):`);
      if (opp.quotes.length > 0) {
        opp.quotes.forEach((q) => {
          lines.push(`  - ${opp.docTitle} (${opp.docId}): “${q.quote}”`);
        });
      } else {
        lines.push(`  - ${opp.docTitle} (${opp.docId}): flagged conflicting without a paired quote`);
      }
    }
  });
  lines.push("");
  lines.push(`## Source cross-check (Clocked Compare)`);
  result.compare.pairs.forEach((p, i) => {
    const meta = compareRelationMeta(p.relation);
    lines.push(`- Pair ${i + 1}: ${p.a} ↔ ${p.b} — ${meta.label} (related ${(p.related * 100).toFixed(0)}%)`);
    (p.conflicts ?? []).forEach((f, j) => {
      lines.push(`  - Conflict ${j + 1}${f.kind ? ` (${f.kind})` : ""}:`);
      if (f.a) lines.push(`    - ${f.a.document}: “${f.a.quote}”`);
      if (f.b) lines.push(`    - ${f.b.document}: “${f.b.quote}”`);
    });
  });
  lines.push("");
  lines.push(`## Passage shortlist (Clocked Rerank)`);
  result.rerank.results.forEach((r) => {
    lines.push(`- \`${r.passage?.id ?? r.index}\` ${r.action}${r.reason ? ` (${r.reason})` : ""} — relevance ${(r.relevance_score * 100).toFixed(0)}%`);
  });
  lines.push("");
  lines.push(`## Endpoint trace (live Clocked calls)`);
  result.trace.forEach((t) => {
    const bits = [
      t.endpoint,
      t.latencyMs !== undefined ? `${t.latencyMs} ms` : undefined,
      t.model,
      t.inputTokens !== undefined ? `${t.inputTokens} in-tokens` : undefined,
      t.attempts !== undefined && t.attempts > 1
        ? `${t.attempts} attempts (same idempotency key)`
        : undefined,
    ].filter(Boolean);
    lines.push(
      `- ${t.step}${t.ok ? "" : " — FAILED"} — ${bits.join(" · ")}${t.error ? ` (${t.error.code}: ${t.error.message})` : ""}`,
    );
  });
  lines.push("");
  lines.push(`---`);
  lines.push(`ProofBrief is a working title. Verdicts describe support in the supplied documents, not truth in the outside world. All demo data is synthetic.`);
  return lines.join("\n");
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportBar({
  demoCase,
  result,
}: {
  demoCase: DemoCase;
  result: AnalysisResult;
}) {
  const base = `proofbrief-evidence-${demoCase.id}-${new Date(result.ranAt).toISOString().slice(0, 10)}`;
  return (
    <section
      aria-label="Export evidence packet"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
    >
      <p className="max-w-md text-sm text-muted-foreground">
        The workflow ends here: export the evidence packet for a human to read and decide.
        ProofBrief has no send button.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="border-teal-300 text-teal-800 hover:bg-teal-50"
          onClick={() => download(`${base}.md`, buildMarkdown(demoCase, result), "text/markdown")}
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Markdown packet
        </Button>
        <Button
          variant="outline"
          className="border-teal-300 text-teal-800 hover:bg-teal-50"
          onClick={() =>
            download(`${base}.json`, JSON.stringify({ case: demoCase, result }, null, 2), "application/json")
          }
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Raw JSON
        </Button>
      </div>
    </section>
  );
}
