// ProofBrief — the single review screen.
// Question, draft, sources in; Rerank, Verify, Compare outputs out; every
// state traceable to a Clocked verdict, score, or paired passage.

"use client";

import { useMemo, useState } from "react";
import { CASES, getCase } from "@/lib/cases";
import type { AnalysisResult } from "@/lib/analysis";
import { CaseSelector } from "@/components/proofbrief/CaseSelector";
import { TriageBanner } from "@/components/proofbrief/TriageBanner";
import { TraceCard } from "@/components/proofbrief/TraceCard";
import { RerankCard } from "@/components/proofbrief/RerankCard";
import { VerifyCard } from "@/components/proofbrief/VerifyCard";
import { CompareCard } from "@/components/proofbrief/CompareCard";
import { ExportBar } from "@/components/proofbrief/ExportBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ShieldCheck,
  MessageCircleQuestion,
  FileText,
  FolderOpen,
  Play,
  TriangleAlert,
  ScrollText,
} from "lucide-react";

export default function Home() {
  const [caseId, setCaseId] = useState<string>(CASES[0].id);
  const [results, setResults] = useState<Record<string, AnalysisResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const demoCase = useMemo(() => getCase(caseId) ?? CASES[0], [caseId]);
  const result = results[caseId];
  const docTitles = useMemo(
    () => Object.fromEntries(demoCase.docs.map((d) => [d.id, d.title])),
    [demoCase],
  );
  const docsById = useMemo(
    () => Object.fromEntries(demoCase.docs.map((d) => [d.id, d])),
    [demoCase],
  );

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ code: data.error ?? `http_${res.status}`, message: data.message ?? "The analysis request failed." });
      } else {
        setResults((prev) => ({ ...prev, [caseId]: data as AnalysisResult }));
      }
    } catch (e) {
      setError({ code: "network", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-700 text-white" aria-hidden="true">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight text-foreground">ProofBrief</span>
            <Badge variant="outline" className="border-stone-300 bg-stone-50 text-[10px] font-normal text-stone-600">
              working title
            </Badge>
          </div>
          <p className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
            Evidence review for draft replies — every claim checked against your own documents.
          </p>
          <Badge variant="outline" className="ml-auto border-teal-200 bg-teal-50 text-teal-800 sm:ml-0">
            Clocked Build Challenge 2026 · Verify / Compare / Rerank
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        <CaseSelector selectedId={caseId} onSelect={(id) => { setCaseId(id); setError(null); }} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Inputs column */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircleQuestion className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  Customer question
                </CardTitle>
                <CardDescription>Synthetic scenario: Northwind Cloud Services replying to Acme Retail.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-foreground">{demoCase.question}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(demoCase.context).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="border-border bg-muted/50 font-normal text-muted-foreground">
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  Draft reply under review
                </CardTitle>
                <CardDescription>
                  Written by an agent or a teammate. ProofBrief checks it; it never sends it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
                  {demoCase.draft}
                </p>
                <Button
                  onClick={runAnalysis}
                  disabled={loading}
                  className="w-full bg-teal-700 font-semibold text-white hover:bg-teal-800 sm:w-auto"
                  aria-label="Run the evidence check with live Clocked endpoints"
                >
                  <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {loading ? "Checking evidence…" : "Run evidence check"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Runs the live Rerank, Verify, and Compare endpoints. Requires CLOCKED_API_KEY on the
                  server. Outputs are never faked.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderOpen className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  Source documents
                </CardTitle>
                <CardDescription>
                  {demoCase.docs.length} synthetic documents, split into a passage registry with
                  character offsets before any call is made.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {demoCase.docs.map((d) => (
                    <AccordionItem key={d.id} value={d.id}>
                      <AccordionTrigger className="text-sm hover:no-underline">
                        <span className="flex items-center gap-2">
                          <ScrollText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <span className="font-medium">{d.title}</span>
                          <span className="font-mono text-xs text-muted-foreground">{d.id}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground/85">
                          {d.text}
                        </pre>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </div>

          {/* Analysis column */}
          <div className="space-y-6 lg:col-span-3" aria-live="polite">
            {error && (
              <Alert variant="destructive" role="alert">
                <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Evidence check could not run</AlertTitle>
                <AlertDescription>
                  {error.code === "missing_key" ? (
                    <>
                      {error.message}{" "}
                      <span className="font-medium">
                        This screen intentionally shows the error instead of faking endpoint output.
                      </span>
                    </>
                  ) : (
                    <>
                      {error.code}: {error.message}
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {loading && (
              <Card>
                <CardContent className="space-y-3 p-6">
                  <p className="text-sm font-medium text-foreground">
                    Calling the live Clocked endpoints: Rerank, Verify, Compare…
                  </p>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <p className="text-xs text-muted-foreground">
                    Three live requests with fresh idempotency keys. Model reads can take a moment.
                  </p>
                </CardContent>
              </Card>
            )}

            {!loading && result && (
              <>
                <TriageBanner triage={result.triage} />
                <TraceCard trace={result.trace} />
                <VerifyCard verify={result.verify} docTitles={docTitles} />
                <CompareCard compare={result.compare} docTitles={docTitles} docs={docsById} />
                <RerankCard rerank={result.rerank} />
                <ExportBar demoCase={demoCase} result={result} />
              </>
            )}

            {!loading && !result && !error && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                  <ShieldCheck className="h-8 w-8 text-teal-700" aria-hidden="true" />
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Select a case and run the evidence check. The review state, claim ledger,
                    cross-check, and passage shortlist below are all driven by what the endpoints
                    actually return.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Language contract: “supported by these documents”, never “verified true”; not established
            means no source states it, not that it is false.
          </p>
          <p className="shrink-0">ProofBrief (working title) · all demo data is synthetic</p>
        </div>
      </footer>
    </div>
  );
}
