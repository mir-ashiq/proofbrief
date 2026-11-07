// ProofBrief — display metadata for endpoint outputs.
// The language contract lives here: the interface says "supported by these
// documents", never "verified true"; not_stated renders as "not established",
// never as "false".

export const CLAIM_VERDICT_META: Record<
  string,
  { label: string; badge: string; dot: string }
> = {
  supported: {
    label: "Supported by these documents",
    badge: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  contradicted: {
    label: "Conflicts with a source",
    badge: "border-rose-300 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
  not_stated: {
    label: "Not established by these sources",
    badge: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  not_a_claim: {
    label: "Not a factual claim",
    badge: "border-slate-300 bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  },
};

export function claimVerdictMeta(verdict: string) {
  return (
    CLAIM_VERDICT_META[verdict] ?? {
      label: verdict,
      badge: "border-slate-300 bg-slate-100 text-slate-600",
      dot: "bg-slate-400",
    }
  );
}

export const RERANK_ACTION_META: Record<
  string,
  { label: string; badge: string }
> = {
  use: { label: "Use", badge: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  expand: { label: "Expand", badge: "border-teal-300 bg-teal-50 text-teal-800" },
  skip: { label: "Skip", badge: "border-slate-300 bg-slate-100 text-slate-500" },
};

export function rerankActionMeta(action: string) {
  return RERANK_ACTION_META[action] ?? {
    label: action,
    badge: "border-slate-300 bg-slate-100 text-slate-500",
  };
}

export const COMPARE_RELATION_META: Record<
  string,
  { label: string; badge: string }
> = {
  same: { label: "Same", badge: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  overlapping: { label: "Overlapping", badge: "border-teal-300 bg-teal-50 text-teal-800" },
  conflicting: { label: "Conflicting", badge: "border-rose-300 bg-rose-50 text-rose-800" },
  unrelated: { label: "Unrelated", badge: "border-slate-300 bg-slate-100 text-slate-500" },
};

export function compareRelationMeta(relation: string) {
  return (
    COMPARE_RELATION_META[relation] ?? {
      label: relation,
      badge: "border-slate-300 bg-slate-100 text-slate-500",
    }
  );
}

export const TRIAGE_META: Record<
  string,
  {
    title: string;
    blurb: string;
    container: string;
    badge: string;
  }
> = {
  ready_for_review: {
    title: "Ready for human review",
    blurb: "All counted claims are supported by these documents. A human makes the final call.",
    container: "border-emerald-300 bg-emerald-50",
    badge: "border-emerald-400 bg-emerald-100 text-emerald-900",
  },
  conflict_needs_decision: {
    title: "Conflict — needs a human decision",
    blurb: "A source pair or a draft claim is in conflict. Approval is blocked until someone decides.",
    container: "border-amber-400 bg-amber-50",
    badge: "border-amber-400 bg-amber-100 text-amber-900",
  },
  missing_evidence: {
    title: "Missing evidence — needs input",
    blurb: "At least one claim is not established by the supplied sources. Add sources or rewrite the claim.",
    container: "border-stone-300 bg-stone-50",
    badge: "border-stone-400 bg-stone-100 text-stone-900",
  },
  review_required: {
    title: "Review required",
    blurb: "An endpoint error or unusable result means this draft cannot be cleared automatically.",
    container: "border-slate-300 bg-slate-100",
    badge: "border-slate-400 bg-slate-100 text-slate-900",
  },
};

export function formatProb(p: number | undefined): string {
  if (p === undefined || p === null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(0)}%`;
}
