// ProofBrief — /api/analyze
// Orchestrates the live Clocked calls for a demo case and returns the joined
// evidence plus an endpoint trace for the review screen. The API key stays
// server-side; nothing on this path is ever faked.
//
// Pipeline:
//   1. Rerank   — rank every registry passage against the question (shortlist)
//   2. Verify   — judge each draft claim against the supplied documents
//   3. Compare  — cross-check the source documents pairwise
//   4. Rerank ×  — for claims Verify returned not_stated (max 3), a follow-up
//                  lookup with the claim as query shows the nearest sources.
//                  Display-only enrichment: it never changes the review state.

import { NextRequest, NextResponse } from "next/server";
import { getCase } from "@/lib/cases";
import { buildRegistry, toRerankDocuments, joinResultToPassage } from "@/lib/registry";
import { rerank, verify, compare, ClockedError, hasApiKey, type ClockedCall } from "@/lib/clocked";
import {
  computeTriage,
  RERANK_INSTRUCTIONS,
  VERIFY_INSTRUCTIONS,
  COMPARE_INSTRUCTIONS,
  type AnalysisResult,
  type EnrichedClaim,
  type JoinedRerankResult,
  type TraceEntry,
} from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many not_stated claims get a nearest-source lookup (concurrency budget). */
const MAX_CLOSEST_LOOKUPS = 3;

function toError(e: unknown): { code: string; message: string } {
  if (e instanceof ClockedError) return { code: e.code, message: e.message };
  return { code: "network", message: e instanceof Error ? e.message : String(e) };
}

function traceEntry(
  step: string,
  endpoint: string,
  purpose: string,
  call: ClockedCall<unknown> | null,
  error?: { code: string; message: string },
): TraceEntry {
  const data = call?.data as
    | { model?: string; usage?: { input_tokens?: number } }
    | undefined;
  return {
    step,
    endpoint,
    purpose,
    ok: !error,
    latencyMs: call?.latencyMs,
    model: data?.model,
    inputTokens: data?.usage?.input_tokens,
    idempotencyKeyPrefix: call?.idempotencyKey.slice(0, 8),
    attempts: call?.attempts,
    error,
  };
}

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
  const rerankDocuments = toRerankDocuments(registry);
  const verifyDocuments = demoCase.docs.map((d) => ({ id: d.id, text: d.text }));

  // ---- Stages 1–3: the three core calls, in parallel ----
  const [rerankSettled, verifySettled, compareSettled] = await Promise.allSettled([
    rerank({
      query: demoCase.question,
      documents: rerankDocuments,
      context: demoCase.context,
      instructions: RERANK_INSTRUCTIONS,
    }),
    verify({
      documents: verifyDocuments,
      answer: demoCase.draft,
      question: demoCase.question,
      instructions: VERIFY_INSTRUCTIONS,
      evidence: "all",
    }),
    compare({
      documents: verifyDocuments,
      instructions: COMPARE_INSTRUCTIONS,
      kinds: true,
      evidence: "all",
    }),
  ]);

  // Endpoint trace, in pipeline order.
  const trace: TraceEntry[] = [
    traceEntry(
      "Rerank — passage selection",
      "POST /clocked/rerank",
      "Read every source passage against the question and rank what can support an answer.",
      rerankSettled.status === "fulfilled" ? rerankSettled.value : null,
      rerankSettled.status === "rejected" ? toError(rerankSettled.reason) : undefined,
    ),
    traceEntry(
      "Verify — claim grounding",
      "POST /clocked/grounding",
      "Judge each claim of the draft strictly against the supplied documents.",
      verifySettled.status === "fulfilled" ? verifySettled.value : null,
      verifySettled.status === "rejected" ? toError(verifySettled.reason) : undefined,
    ),
    traceEntry(
      "Compare — source cross-check",
      "POST /clocked/compare",
      "Cross-check the source documents pairwise for conflicts and overlaps.",
      compareSettled.status === "fulfilled" ? compareSettled.value : null,
      compareSettled.status === "rejected" ? toError(compareSettled.reason) : undefined,
    ),
  ];

  const rerankOk = rerankSettled.status === "fulfilled";
  const verifyOk = verifySettled.status === "fulfilled";
  const compareOk = compareSettled.status === "fulfilled";

  const rerankResponse = rerankOk ? rerankSettled.value.data : null;
  const verifyResponse = verifyOk ? verifySettled.value.data : null;
  const compareResponse = compareOk ? compareSettled.value.data : null;

  // Join Rerank results back to the registry by id (fallback: index).
  const joinedResults: JoinedRerankResult[] = (rerankResponse?.results ?? []).map((r) => ({
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

  // ---- Stage 4: nearest-source lookups for not_stated claims (enrichment) ----
  const rawClaims = verifyResponse?.claims ?? [];
  const notStated = rawClaims
    .map((c, i) => ({ claim: c.claim, index: i }))
    .filter(({ index }) => {
      const c = rawClaims[index];
      return c.counted !== false && c.verdict === "not_stated";
    })
    .slice(0, MAX_CLOSEST_LOOKUPS);

  const closestByIndex = new Map<number, JoinedRerankResult[]>();
  if (notStated.length > 0) {
    const lookups = await Promise.allSettled(
      notStated.map(({ claim }) =>
        rerank({
          query: claim,
          documents: rerankDocuments,
          context: demoCase.context,
          instructions: RERANK_INSTRUCTIONS,
          top_n: 3,
        }),
      ),
    );
    lookups.forEach((settled, j) => {
      const { claim, index } = notStated[j];
      const short = claim.length > 90 ? claim.slice(0, 90) + "…" : claim;
      if (settled.status === "fulfilled") {
        closestByIndex.set(
          index,
          settled.value.data.results.map((r) => ({
            ...r,
            passage: joinResultToPassage(r, registry, sentOrder),
          })),
        );
        trace.push(
          traceEntry(
            `Rerank — nearest sources for claim #${index + 1}`,
            "POST /clocked/rerank",
            `Not established by the sources; look up what they do say that comes closest: "${short}"`,
            settled.value,
            undefined,
          ),
        );
      } else {
        trace.push(
          traceEntry(
            `Rerank — nearest sources for claim #${index + 1}`,
            "POST /clocked/rerank",
            `Not established by the sources; nearest-source lookup failed (enrichment only — the review state is unaffected).`,
            null,
            toError(settled.reason),
          ),
        );
      }
    });
  }

  const enrichedClaims: EnrichedClaim[] = rawClaims.map((c, i) => ({
    ...c,
    closest: closestByIndex.get(i),
  }));

  const triage = computeTriage({
    rerankOk,
    rerankError: rerankOk ? undefined : toError(rerankSettled.reason),
    rerankResults: joinedResults,
    verifyOk,
    verifyError: verifyOk ? undefined : toError(verifySettled.reason),
    claims: enrichedClaims,
    compareOk,
    compareError: compareOk ? undefined : toError(compareSettled.reason),
    pairs: compareResponse?.pairs ?? [],
    conflictIndexes: allConflictIndexes,
  });

  const result: AnalysisResult = {
    caseId: demoCase.id,
    ranAt: new Date().toISOString(),
    triage,
    trace,
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
      claims: enrichedClaims,
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
