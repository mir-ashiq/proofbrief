// ProofBrief — endpoint trace: every live Clocked call made for this run,
// with its purpose, latency, model, and idempotency-key prefix. This panel
// exists so the endpoint integration is visible, not implied.

import type { AnalysisResult } from "@/lib/analysis";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle } from "lucide-react";

const DOCS = [
  { label: "/docs/rerank", href: "https://clocked.rezolve.ai/docs/rerank" },
  { label: "/docs/grounding", href: "https://clocked.rezolve.ai/docs/grounding" },
  { label: "/docs/compare", href: "https://clocked.rezolve.ai/docs/compare" },
];

export function TraceCard({ trace }: { trace: AnalysisResult["trace"] }) {
  const okCount = trace.filter((t) => t.ok).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-teal-700" aria-hidden="true" />
            Endpoint trace
          </CardTitle>
          <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-800">
            {okCount}/{trace.length} live calls succeeded
          </Badge>
        </div>
        <CardDescription>
          Every Clocked request made for this run. Each logical request carries a fresh UUID
          Idempotency-Key, reused verbatim on retry; keys are generated server-side and only a
          prefix is shown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {trace.map((t, i) => (
            <li
              key={i}
              className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border p-2.5 ${
                t.ok ? "border-border bg-card" : "border-rose-200 bg-rose-50/60"
              }`}
            >
              {t.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t.step}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{t.purpose}</p>
                {t.error && (
                  <p className="mt-1 text-xs text-rose-700">
                    {t.error.code}: {t.error.message}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                <span>{t.endpoint}</span>
                {t.latencyMs !== undefined && <span>{t.latencyMs} ms</span>}
                {t.model && <span>{t.model}</span>}
                {t.inputTokens !== undefined && <span>{t.inputTokens} in-tokens</span>}
                {t.attempts !== undefined && t.attempts > 1 && (
                  <span>{t.attempts} attempts (same idempotency key)</span>
                )}
                {t.idempotencyKeyPrefix && (
                  <span title="Idempotency-Key, first 8 characters">idem {t.idempotencyKeyPrefix}…</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Reference:{" "}
          {DOCS.map((d, i) => (
            <span key={d.href}>
              {i > 0 && " · "}
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted hover:text-foreground"
              >
                {d.label}
              </a>
            </span>
          ))}
        </p>
      </CardContent>
    </Card>
  );
}
