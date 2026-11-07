// ProofBrief — triage banner: the review state computed from live outputs.

import type { TriageStateInfo } from "@/lib/analysis";
import { TRIAGE_META } from "@/lib/display";
import { CheckCircle2, AlertTriangle, FileQuestion, ShieldAlert, Hourglass } from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  ready_for_review: <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />,
  conflict_needs_decision: <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />,
  missing_evidence: <FileQuestion className="h-5 w-5 text-stone-600" aria-hidden="true" />,
  review_required: <ShieldAlert className="h-5 w-5 text-slate-600" aria-hidden="true" />,
  analysis_incomplete: <Hourglass className="h-5 w-5 text-sky-700" aria-hidden="true" />,
};

export function TriageBanner({ triage }: { triage: TriageStateInfo }) {
  const meta = TRIAGE_META[triage.state] ?? TRIAGE_META.review_required;
  return (
    <section
      aria-label={`Review state: ${meta.title}`}
      className={`rounded-lg border-2 p-4 ${meta.container}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{ICONS[triage.state] ?? ICONS.review_required}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-base font-bold text-foreground">{meta.title}</h3>
          <p className="text-sm text-foreground/80">{meta.blurb}</p>
          <ul className="space-y-1" aria-label="Reasons">
            {triage.reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" aria-hidden="true" />
                <span className="min-w-0">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
