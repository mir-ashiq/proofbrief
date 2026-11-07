// ProofBrief — /api/analyze
// Orchestrates the live Clocked calls for a demo case and returns the joined
// evidence plus an endpoint trace for the review screen. The API key stays
// server-side; nothing on this path is ever faked.
//
// Pipeline:
//   0. Guard    — one analysis at a time per instance (a run fires 3 core
//                 calls in parallel; Clocked's build tier allows 4 concurrent
//                 requests), plus a short per-IP cooldown. Over the cap the
//                 route answers 429 "busy" so the client can retry, matching
//                 the platform's limits guidance: wait, never parallelize.
//   0b. Budget  — every call, retry, and optional lookup of a run is capped to
//                 fit a hard wall-clock budget (ANALYSIS_BUDGET_MS) well inside
//                 this route's maxDuration, so the platform can never kill the
//                 function mid-run: the run itself gives up first and answers
//                 analysis_incomplete (retry later — never a verdict, never a
//                 source conflict). Optional enrichment is skipped when any
//                 core call failed or the remaining budget is short.
//   1. Rerank   — rank every registry passage against the question (shortlist)
//   2. Verify   — judge each draft claim against the supplied documents
//   3. Compare  — cross-check the source documents pairwise
//   4. Validate — every response is checked against the documented shape
//                 (enum allowlists, 0–1 scores, integer offsets). Anything
//                 unexpected fails closed: the endpoint counts as not-ok and
//                 the review state can never be "ready" from that output.
//   5. Rerank × — follow-up lookups with the claim as query, for claims that
//                  are not established or that returned no evidence quote.
//                  Display-only enrichment: it never changes the review state.
//   6. Join     — contradicted claims are linked to the opposing passage of the
//                  Compare-flagged pair (both sides stay live endpoint outputs).

import { NextRequest, NextResponse } from "next/server";
import { getCase } from "@/lib/cases";
import { buildRegistry, toRerankDocuments, joinResultToPassage } from "@/lib/registry";
import {
  rerank,
  verify,
  compare,
  ClockedError,
  hasApiKey,
  type ClockedCall,
} from "@/lib/clocked";
import {
  validateRerankResponse,
  validateVerifyResponse,
  validateCompareResponse,
  type ValidationResult,
} from "@/lib/validate";
import {
  computeTriage,
  findOpposingEvidence,
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
/** Platform cap for the function; the run's own hard budget (ANALYSIS_BUDGET_MS) sits 10 s under it, so the route always answers before this limit. */
export const maxDuration = 60;

/** How many claims get a nearest-source lookup (concurrency budget). */
const MAX_CLOSEST_LOOKUPS = 4;
/** Lookups run in waves of at most this size, after the core calls settle. */
const LOOKUP_WAVE_SIZE = 3;

/**
 * Hard wall-clock budget for one analysis run, in ms.
 *
 * The route's maxDuration is 60 s, but a single logical Clocked request can
 * wait up to 120 s per attempt across 3 attempts, and the follow-up lookups
 * add up to two more waves — without a budget the worst case is minutes and
 * the platform would terminate the function mid-run with no review state at
 * all. Every attempt timeout, backoff, and optional lookup is instead capped
 * to finish by this deadline (see CallOptions in src/lib/clocked.ts), so the
 * run answers within 50 s and leaves ~10 s of margin for validation, joins,
 * JSON serialization, and delivery before maxDuration. A run that runs out
 * of budget fails closed as analysis_incomplete — never "ready", never a
 * source conflict. 50 s is also generous in practice: observed per-call
 * latencies are well under one second (docs/test-log.md), so the budget only
 * binds when an endpoint hangs or throttles.
 */
const ANALYSIS_BUDGET_MS = 50_000;
/**
 * A lookup wave (optional, display-only enrichment) is only started with at
 * least this much budget left — enough for a rerank attempt plus a short
 * backoff. The per-call deadline remains the hard cap either way.
 */
const ENRICHMENT_MIN_REMAINING_MS = 10_000;

// ---- Concurrency / rate guard (best-effort, per serverless instance) ----
//
// One analysis at a time: the three core calls run in parallel, so a single
// analysis already uses 3 of the 4 concurrent requests the Clocked build tier
// allows. Two overlapping analyses would trip the platform's 429 throttling
// (observed once during concurrent rechecks on 2026-11-07). Module state is
// per-instance on serverless — a hard cap would need durable storage; for
// this demo the guard plus client-side retry keeps a lone reviewer smooth,
// and a 429 from us or from Clocked both land in the same
// "analysis incomplete — retry later" state, never a false verdict.

let analysesInFlight = 0;
const MAX_CONCURRENT_ANALYSES = 1;
const lastStartedByIp = new Map<string, number>();
const IP_COOLDOWN_MS = 4000;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

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

/**
 * Outcome of one core endpoint call: HTTP result (if any) plus runtime
 * validation. A response that does not match the documented shape makes the
 * outcome not-ok with code "invalid_response" — the raw output is never used.
 */
type Outcome<T> = {
  ok: boolean;
  error?: { code: string; message: string };
  call: ClockedCall<T> | null;
  data: T | null;
};

function toOutcome<T>(
  settled: PromiseSettledResult<ClockedCall<T>>,
  validate: (data: unknown) => ValidationResult,
  name: string,
): Outcome<T> {
  if (settled.status === "rejected") {
    return { ok: false, error: toError(settled.reason), call: null, data: null };
  }
  const call = settled.value;
  const validation = validate(call.data);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: `${name} response failed validation (${validation.message}); failing closed instead of displaying an ununderstood output.`,
      },
      call,
      data: null,
    };
  }
  return { ok: true, call, data: call.data };
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

  // Concurrency guard: one analysis at a time per instance, with a short
  // per-IP cooldown. Answer 429 "busy" so the client retries in a moment.
  const ip = clientIp(req);
  const now = Date.now();
  const lastForIp = lastStartedByIp.get(ip);
  if (analysesInFlight >= MAX_CONCURRENT_ANALYSES || (lastForIp !== undefined && now - lastForIp < IP_COOLDOWN_MS)) {
    return NextResponse.json(
      {
        error: "busy",
        message:
          "Another evidence check is still running — this demo runs one analysis at a time to stay inside Clocked's concurrency limits. Wait a few seconds and run the check again. This is not a source conflict.",
      },
      { status: 429 },
    );
  }
  analysesInFlight += 1;
  lastStartedByIp.set(ip, now);
  try {
    return await runAnalysis(demoCase);
  } finally {
    analysesInFlight -= 1;
  }
}

async function runAnalysis(demoCase: NonNullable<ReturnType<typeof getCase>>): Promise<NextResponse> {
  // The run's hard deadline: every Clocked call below receives it and caps
  // its attempts, backoffs, and retries to fit (see src/lib/clocked.ts).
  const deadline = Date.now() + ANALYSIS_BUDGET_MS;

  // Registry: passages with ids and offsets, built before any call is made.
  const registry = buildRegistry(demoCase.docs);
  const sentOrder = registry;
  const rerankDocuments = toRerankDocuments(registry);
  const verifyDocuments = demoCase.docs.map((d) => ({ id: d.id, text: d.text }));

  // ---- Stages 1–3: the three core calls, in parallel ----
  const [rerankSettled, verifySettled, compareSettled] = await Promise.allSettled([
    rerank(
      {
        query: demoCase.question,
        documents: rerankDocuments,
        context: demoCase.context,
        instructions: RERANK_INSTRUCTIONS,
      },
      { deadline },
    ),
    verify(
      {
        documents: verifyDocuments,
        answer: demoCase.draft,
        question: demoCase.question,
        instructions: VERIFY_INSTRUCTIONS,
        evidence: "all",
      },
      { deadline },
    ),
    compare(
      {
        documents: verifyDocuments,
        instructions: COMPARE_INSTRUCTIONS,
        kinds: true,
        evidence: "all",
      },
      { deadline },
    ),
  ]);

  // ---- Stage 4: runtime validation of every response (fail closed) ----
  const rerankOutcome = toOutcome(rerankSettled, validateRerankResponse, "Rerank");
  const verifyOutcome = toOutcome(verifySettled, validateVerifyResponse, "Verify");
  const compareOutcome = toOutcome(compareSettled, validateCompareResponse, "Compare");

  // Endpoint trace, in pipeline order.
  const trace: TraceEntry[] = [
    traceEntry(
      "Rerank — passage selection",
      "POST /clocked/rerank",
      "Read every source passage against the question and rank what can support an answer.",
      rerankOutcome.call,
      rerankOutcome.error,
    ),
    traceEntry(
      "Verify — claim grounding",
      "POST /clocked/grounding",
      "Judge each claim of the draft strictly against the supplied documents.",
      verifyOutcome.call,
      verifyOutcome.error,
    ),
    traceEntry(
      "Compare — source cross-check",
      "POST /clocked/compare",
      "Cross-check the source documents pairwise for conflicts and overlaps.",
      compareOutcome.call,
      compareOutcome.error,
    ),
  ];

  const rerankOk = rerankOutcome.ok;
  const verifyOk = verifyOutcome.ok;
  const compareOk = compareOutcome.ok;

  const rerankResponse = rerankOutcome.data;
  const verifyResponse = verifyOutcome.data;
  const compareResponse = compareOutcome.data;

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

  // ---- Stage 5: nearest-source lookups (display-only enrichment) ----
  // Runs for claims Verify marked not_stated, and for counted claims that
  // returned no evidence quote (e.g. supported without a passage), so a claim
  // is never left with nothing to look at. It never replaces a Verify verdict
  // and never changes the review state.
  const rawClaims = verifyResponse?.claims ?? [];
  const lookupTargets = rawClaims
    .map((c, i) => ({ claim: c.claim, index: i, verdict: c.verdict }))
    .filter(
      ({ index, verdict }) =>
        rawClaims[index].counted !== false &&
        verdict !== "not_a_claim" &&
        (verdict === "not_stated" || !rawClaims[index].evidence),
    )
    .slice(0, MAX_CLOSEST_LOOKUPS);

  const closestByIndex = new Map<number, JoinedRerankResult[]>();
  // Optional, display-only: skip the lookups entirely when any core call
  // failed (the run is already analysis_incomplete / review_required, and a
  // failing endpoint would likely fail again) or when the remaining budget
  // cannot fit a lookup wave. Enrichment never changes the review state.
  const coreOk = rerankOk && verifyOk && compareOk;
  for (let w = 0; coreOk && w < lookupTargets.length; w += LOOKUP_WAVE_SIZE) {
    if (deadline - Date.now() < ENRICHMENT_MIN_REMAINING_MS) break;
    const wave = lookupTargets.slice(w, w + LOOKUP_WAVE_SIZE);
    const lookups = await Promise.allSettled(
      wave.map(({ claim }) =>
        rerank(
          {
            query: claim,
            documents: rerankDocuments,
            context: demoCase.context,
            instructions: RERANK_INSTRUCTIONS,
            top_n: 3,
          },
          { deadline },
        ),
      ),
    );
    lookups.forEach((settled, j) => {
      const { claim, index, verdict } = wave[j];
      const notEstablished = verdict === "not_stated";
      const short = claim.length > 90 ? claim.slice(0, 90) + "…" : claim;
      const step = `Rerank — nearest sources for claim #${index + 1}`;
      const outcome = toOutcome(settled, validateRerankResponse, "Rerank");
      if (outcome.ok && outcome.data) {
        closestByIndex.set(
          index,
          outcome.data.results.map((r) => ({
            ...r,
            passage: joinResultToPassage(r, registry, sentOrder),
          })),
        );
        trace.push(
          traceEntry(
            step,
            "POST /clocked/rerank",
            notEstablished
              ? `Not established by the sources; look up what they do say that comes closest: "${short}"`
              : `Verify returned no evidence quote; look up the most relevant source passage: "${short}"`,
            outcome.call,
            undefined,
          ),
        );
      } else {
        trace.push(
          traceEntry(
            step,
            "POST /clocked/rerank",
            notEstablished
              ? `Not established by the sources; nearest-source lookup failed (enrichment only — the review state is unaffected).`
              : `No evidence quote returned; nearest-source lookup failed (enrichment only — the review state is unaffected).`,
            outcome.call,
            outcome.error,
          ),
        );
      }
    });
  }

  // ---- Stage 6: join contradicted claims to the opposing side of a flagged pair ----
  // Which side of a flagged pair opposes the claim is decided by wording
  // (claim text vs. each side's passages), so the join cannot flip when Verify
  // happens to cite either passage as evidence. Display-only.
  const docMap = Object.fromEntries(
    demoCase.docs.map((d) => [d.id, { title: d.title, text: d.text }]),
  );
  const enrichedClaims: EnrichedClaim[] = rawClaims.map((c, i) => ({
    ...c,
    closest: closestByIndex.get(i),
    opposing:
      verifyOk && compareOk
        ? findOpposingEvidence(c, compareResponse?.pairs ?? [], allConflictIndexes, docMap)
        : undefined,
  }));

  const triage = computeTriage({
    rerankOk,
    rerankError: rerankOutcome.error,
    rerankResults: joinedResults,
    verifyOk,
    verifyError: verifyOutcome.error,
    claims: enrichedClaims,
    // Relevance gate: grounding (per-claim support) and answers_question
    // (does the draft address the question) are separate Verify signals.
    answersQuestion: verifyResponse?.answers_question,
    compareOk,
    compareError: compareOutcome.error,
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
      error: rerankOutcome.error,
      model: rerankResponse?.model,
      results: joinedResults,
    },
    verify: {
      ok: verifyOk,
      error: verifyOutcome.error,
      model: verifyResponse?.model,
      grounded: verifyResponse?.grounded,
      threshold: verifyResponse?.threshold,
      claims: enrichedClaims,
      answers_question: verifyResponse?.answers_question,
    },
    compare: {
      ok: compareOk,
      error: compareOutcome.error,
      model: compareResponse?.model,
      verdict: compareResponse?.verdict,
      pairs: compareResponse?.pairs ?? [],
      conflictIndexes: allConflictIndexes,
    },
  };

  return NextResponse.json(result);
}
