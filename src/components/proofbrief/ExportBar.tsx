// ProofBrief — evidence packet export. This is the end of the workflow:
// a human receives the packet and decides. Nothing is sent anywhere.

import type { DemoCase } from "@/lib/cases";
import type { AnalysisResult } from "@/lib/analysis";
import { buildMarkdown } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

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
