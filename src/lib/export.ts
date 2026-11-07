// ProofBrief — evidence packet export (Markdown).
// The workflow ends here: a human receives the packet and decides. Nothing is
// sent anywhere.
//
// The packet uses the SAME quote resolution the UI uses (resolveQuote in
// src/lib/registry.ts): an endpoint extraction that carries no body — e.g. a
// bare "## Audit log retention" heading — is exported as the full section of
// its source document, located by the endpoint's own character offsets, with
// the raw extraction kept in the attribution note. What a reviewer reads in
// the packet is identical to what the on-screen review showed.

import type { DemoCase } from "./cases";
import type { AnalysisResult } from "./analysis";
import { resolveQuote } from "./registry";
import { claimVerdictMeta, compareRelationMeta } from "./display";

export function buildMarkdown(demoCase: DemoCase, result: AnalysisResult): string {
  const docsById = new Map(demoCase.docs.map((d) => [d.id, d]));
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
      // A supported claim without a Verify evidence quote carries its top
      // `use` passage as the claim-level quote in the UI; mirror it here.
      const topUse =
        !c.evidence && c.verdict !== "not_stated" && c.verdict !== "not_a_claim"
          ? c.closest.find((r) => r.action === "use" && r.passage)
          : undefined;
      if (topUse?.passage) {
        lines.push(
          `No direct Verify evidence was returned for this claim. Closest source passage (Clocked Rerank relevance match — enrichment, not proof; relevance ${(topUse.relevance_score * 100).toFixed(0)}%): “${topUse.passage.text}” — ${topUse.passage.docTitle}, section “${topUse.passage.section}”`,
        );
      }
      lines.push(
        c.verdict === "not_stated"
          ? `Nearest sources (Clocked Rerank, enrichment only — these did not establish the claim):`
          : `Nearest sources by relevance (Clocked Rerank, display-only):`,
      );
      c.closest
        .filter((r) => r !== topUse)
        .forEach((r) => {
          lines.push(`  - \`${r.passage?.id ?? r.index}\` ${r.action}${r.reason ? ` (${r.reason})` : ""} — “${(r.passage?.text ?? "").slice(0, 160)}”`);
        });
    }
    const opp = c.opposing;
    if (opp) {
      if (!opp.indeterminate && opp.opposing) {
        const opposing = opp.opposing;
        lines.push(`Opposing passage — the other side of the flagged source pair (Clocked Compare, pair index ${opp.pairIndex}):`);
        if (opposing.quotes.length > 0) {
          opposing.quotes.forEach((q) => {
            lines.push(
              `  - ${opposing.docTitle} (${opposing.docId}): “${q.quote}”${q.expanded ? ` — endpoint extraction was the section heading only (“${q.raw}”${q.start !== undefined && q.end !== undefined ? `, chars ${q.start}–${q.end}` : ""}); the full section is shown` : ""}`,
            );
          });
        } else {
          lines.push(`  - ${opposing.docTitle} (${opposing.docId}): flagged conflicting without a paired quote`);
        }
        if (opp.claimSide) {
          lines.push(`  - The claim’s wording is closest to ${opp.claimSide.docTitle} (${opp.claimSide.docId}).`);
        }
      } else {
        lines.push(`Both sides of the flagged source pair (Clocked Compare, pair index ${opp.pairIndex}) — the claim’s side could not be told apart by wording:`);
        opp.sides.forEach((s) => {
          if (s.quotes.length === 0) {
            lines.push(`  - ${s.docTitle} (${s.docId}): flagged in this pair without a paired quote`);
          } else {
            s.quotes.forEach((q) => {
              lines.push(`  - ${s.docTitle} (${s.docId}): “${q.quote}”`);
            });
          }
        });
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
      // Same resolution as the UI's compare card and the claim ledger above:
      // an endpoint extraction that is only a heading is exported as its full
      // source section (located by the endpoint's own offsets), with the raw
      // extraction kept in the note. Otherwise the packet would show less
      // than the UI showed for the same finding.
      const side = (loc?: { document: string; quote: string; start?: number; end?: number }) => {
        if (!loc) return;
        const doc = docsById.get(loc.document);
        const resolved = resolveQuote(doc?.text, loc.quote, loc.start, loc.end);
        if (resolved.expanded) {
          // Offsets belong to the endpoint's raw extraction (which was only a
          // heading), not to the full section shown — so they travel with the
          // raw-extraction note, never next to the displayed section text.
          lines.push(`    - ${doc?.title ?? loc.document} (${loc.document}): “${resolved.display}”`);
          lines.push(
            `      — endpoint extraction was the section heading only (“${resolved.raw}”${loc.start !== undefined && loc.end !== undefined ? `, chars ${loc.start}–${loc.end}` : ""}); the full section is shown above`,
          );
        } else {
          lines.push(
            `    - ${doc?.title ?? loc.document} (${loc.document}), chars ${loc.start}–${loc.end}: “${resolved.display}”`,
          );
        }
      };
      side(f.a);
      side(f.b);
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
