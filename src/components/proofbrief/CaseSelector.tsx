// ProofBrief — case selector: the four synthetic scenarios.

import { CASES } from "@/lib/cases";
import { cn } from "@/lib/utils";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function CaseSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Demo cases" className="space-y-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-teal-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
          Synthetic cases
        </h2>
        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
          all data is synthetic
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CASES.map((c) => {
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              aria-pressed={active}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
                active
                  ? "border-teal-600 bg-teal-50 ring-1 ring-teal-600"
                  : "border-border bg-card hover:border-teal-300 hover:bg-teal-50/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-sm font-semibold", active ? "text-teal-900" : "text-foreground")}>
                  {c.name}
                </span>
                {active && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-teal-600" aria-hidden="true" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.scenario}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
