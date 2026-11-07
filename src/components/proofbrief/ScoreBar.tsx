// ProofBrief — small probability bar used across endpoint cards.

export function ScoreBar({
  value,
  label,
  tone = "teal",
}: {
  value: number | undefined;
  label: string;
  tone?: "teal" | "emerald" | "amber" | "rose" | "slate";
}) {
  const pct = value === undefined || Number.isNaN(value) ? 0 : Math.round(value * 100);
  const tones: Record<string, string> = {
    teal: "bg-teal-600",
    emerald: "bg-emerald-600",
    amber: "bg-amber-500",
    rose: "bg-rose-600",
    slate: "bg-slate-400",
  };
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${pct}%`}>
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {value === undefined ? "—" : `${pct}%`}
      </span>
    </div>
  );
}
