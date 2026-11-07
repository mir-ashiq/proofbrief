// ProofBrief — /api/analyze
// Orchestrates the three live Clocked calls for a demo case and returns the
// joined evidence for the review screen. The API key stays server-side.

import { NextRequest, NextResponse } from "next/server";
import { getCase } from "@/lib/cases";
import { buildRegistry, toRerankDocuments, joinResultToPassage } from "@/lib/registry";
import { rerank, verify, compare, ClockedError, hasApiKey } from "@/lib/clocked";
import {
  computeTriage,
  RERANK_INSTRUCTIONS,
  VERIFY_INSTRUCTIONS,
  COMPARE_INSTRUCTIONS,
  type AnalysisResult,
} from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let caseId = "";
  try {
    const body = (await req.json()) as { caseId?: string };
    caseId = body.caseId ?? "";
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  const demoCase = getCase(caseId);
  if (!demoCase) {
    return NextResponse.json({ error: "unknown_case", message: `No case with id "${caseId}".` }, { status: 404 });
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error: "missing_key",
        message:
          "CLOCKED_API_KEY is not configured on the server. Copy .env.example to .env, add your Clocked account API key, and restart. This demo runs the live endpoints and does not fake their outputs.",
      },
      { status: 503 },
    );
  }

  // Registry: passages with ids and offsets, built before any call is made.
  const registry = buildRegistry(demoCase.docs);
  const sentOrder = registry;

  const [rerankSettled, verifySettled, compareSettled] = await Promise.allSettled([
    rerank({
      query: demoCase.question,
      documents: toRerankDocuments(registry),
      context: demoCase.context,
      instructions: RERANK_INSTRUCTIONS,
    }),
    verify({
      documents: demoCase.docs.map((d) => ({ id: d.id, text: d.text })),
      answer: demoCase.draft,
      question: demoCase.question,
      instructions: VERIFY_INSTRUCTIONS,
      evidence: "all",
    }),
    compare({
      documents: demoCase.docs.map((d) => ({ id: d.id, text: d.text })),
      instructions: COMPARE_INSTRUCTIONS,
      kinds: true,
      evidence: "all",
    }),
  ]);

  const toError = (e: unknown) => {
    if (e instanceof ClockedError) return { code: e.code, message: e.message };
    return { code: "network", message: e instanceof Error ? e.message : String(e) };
  };

  const rerankOk = rerankSettled.status === "fulfilled";
  const verifyOk = verifySettled.status === "fulfilled";
  const compareOk = compareSettled.status === "fulfilled";

  const rerankResponse = rerankOk ? rerankSettled.value : null;
  const verifyResponse = verifyOk ? verifySettled.value : null;
  const compareResponse = compareOk ? compareSettled.value : null;

  // Join Rerank results back to the registry by id (fallback: index).
  const joinedResults = (rerankResponse?.results ?? []).map((r) => ({
    ...r,
    passage: joinResultToPassage(r, registry, sentOrder),
  }));

  const conflictIndexes = (compareResponse?.conflicts ?? []).filter(
    (i) => Number.isInteger(i) && i >= 0 && i < (compareResponse?.pairs.length ?? 0),
  );
  // Also catch pairs whose relation is conflicting even if not listed in the index array.
  const allConflictIndexes = Array.from(
    new Set([
      ...conflictIndexes,
      ...(compareResponse?.pairs ?? [])
        .map((p, i) => (p.relation === "conflicting" ? i : -1))
        .filter((i) => i >= 0),
    ]),
  ).sort((a, b) => a - b);

  const triage = computeTriage({
    rerankOk,
    rerankError: rerankOk ? undefined : toError(rerankSettled.reason),
    rerankResults: joinedResults,
    verifyOk,
    verifyError: verifyOk ? undefined : toError(verifySettled.reason),
    claims: verifyResponse?.claims ?? [],
    compareOk,
    compareError: compareOk ? undefined : toError(compareSettled.reason),
    pairs: compareResponse?.pairs ?? [],
    conflictIndexes: allConflictIndexes,
  });

  const result: AnalysisResult = {
    caseId: demoCase.id,
    ranAt: new Date().toISOString(),
    triage,
    rerank: {
      ok: rerankOk,
      error: rerankOk ? undefined : toError(rerankSettled.reason),
      model: rerankResponse?.model,
      results: joinedResults,
    },
    verify: {
      ok: verifyOk,
      error: verifyOk ? undefined : toError(verifySettled.reason),
      model: verifyResponse?.model,
      grounded: verifyResponse?.grounded,
      threshold: verifyResponse?.threshold,
      claims: verifyResponse?.claims ?? [],
      answers_question: verifyResponse?.answers_question,
    },
    compare: {
      ok: compareOk,
      error: compareOk ? undefined : toError(compareSettled.reason),
      model: compareResponse?.model,
      verdict: compareResponse?.verdict,
      pairs: compareResponse?.pairs ?? [],
      conflictIndexes: allConflictIndexes,
    },
  };

  return NextResponse.json(result);
}
