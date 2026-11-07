// ProofBrief — offline checks for the /api/analyze time budget:
//   1. deadline plumbing in the Clocked client (mocked fetch, no network):
//      a past or expiring deadline fails closed fast as "deadline_exceeded",
//      while ordinary 429 retry semantics (bounded attempts, Retry-After,
//      idempotency-key reuse) are preserved under a generous deadline;
//   2. triage mapping: deadline/timeout/throttle failures are
//      analysis_incomplete — never ready_for_review, never a source conflict,
//      even when a conflicting pair was also returned;
//   3. the route's budget configuration: a hard budget of at most 50 s with
//      margin under maxDuration = 60 s, every Clocked call site capped by the
//      deadline, and optional enrichment skipped when a core call failed or
//      the remaining budget is short.
//
// The mock fetch never touches the network; the API key used is a placeholder
// for the offline check only.
//
//   bun scripts/check-time-budget.ts
import { readFileSync } from "fs";
import { rerank, verify, compare, ClockedError, type ClockedCall } from "../src/lib/clocked";
import { computeTriage, isRetryableError, type JoinedRerankResult } from "../src/lib/analysis";
import type { VerifyClaim } from "../src/lib/clocked";
import type { PassageEntry } from "../src/lib/registry";
import { buildRegistry } from "../src/lib/registry";
import { getCase } from "../src/lib/cases";
import { TRIAGE_META } from "../src/lib/display";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function captureError<T>(p: Promise<T>): Promise<{ err: unknown; value: T | null }> {
  try {
    return { err: null, value: await p };
  } catch (err) {
    return { err, value: null };
  }
}

function asClockedError(err: unknown): ClockedError | null {
  return err instanceof ClockedError ? err : null;
}

// ---- Mock fetch (no network) ----

interface MockCall {
  url: string;
  idempotencyKey: string;
  signal: AbortSignal | undefined;
}
type Responder = (call: MockCall) => Promise<Response>;

const realFetch = globalThis.fetch;
let calls: MockCall[] = [];
let responders: Responder[] = [];

/**
 * Placeholder that satisfies the client's server-side key check for the
 * mocked-fetch tests below. Named constant, deliberately not a string literal
 * assigned to the key variable, so the repo's pre-push credential scan stays
 * meaningful. Never a real credential; the mock never touches the network.
 */
const OFFLINE_CHECK_KEY = "offline-check-only-placeholder";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const call: MockCall = {
    url: String(input),
    idempotencyKey: headers["Idempotency-Key"] ?? "",
    signal: init?.signal ?? undefined,
  };
  calls.push(call);
  const responder = responders[calls.length - 1] ?? responders[responders.length - 1];
  if (!responder) throw new Error("test mock: no responder configured");
  return responder(call);
}) as typeof fetch;

const okRerankBody = {
  model: "clocked-1.0",
  results: [{ index: 0, id: "doc-sp21-s2", action: "use", relevance_score: 0.99, document_score: 0.99 }],
};
const okVerifyBody = {
  model: "clocked-1.0",
  grounded: 0.9,
  verdict: "grounded",
  threshold: 0.5,
  claims: [],
};
const okCompareBody = { model: "clocked-1.0", verdict: "no_conflicts", pairs: [] };

const ok = (body: unknown): Responder => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
const throttled = (retryAfterSeconds: string): Responder => () =>
  Promise.resolve(new Response("too many requests", { status: 429, headers: { "retry-after": retryAfterSeconds } }));
const httpStatus = (code: number): Responder => () => Promise.resolve(new Response("err", { status: code }));
/** Hangs until the attempt's abort signal fires, like a stuck endpoint. */
const hang = (call: MockCall): Promise<Response> =>
  new Promise((_resolve, reject) => {
    call.signal?.addEventListener("abort", () => reject(new Error("aborted: test mock hanging endpoint")));
  });

const rerankPayload = {
  query: "q",
  documents: [{ id: "doc-sp21", text: "text", title: "Security Policy v2.1" }],
} as Parameters<typeof rerank>[0];
const verifyPayload = {
  documents: [{ id: "doc-sp21", text: "text" }],
  answer: "draft",
  question: "q",
} as Parameters<typeof verify>[0];
const comparePayload = {
  documents: [{ id: "doc-sp21", text: "text" }],
} as Parameters<typeof compare>[0];

async function main() {
  // Bun's AbortSignal.timeout fires but does not keep the event loop alive,
  // which would let the process exit before the hanging-endpoint check
  // settles. Hold the loop open for the whole script instead.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
  // The client reads the key from the environment; use the placeholder.
  process.env.CLOCKED_API_KEY = OFFLINE_CHECK_KEY;

  console.log("1) Deadline plumbing in the Clocked client (mocked fetch)");

  calls = [];
  responders = [ok(okRerankBody)];
  const past = await captureError(rerank(rerankPayload, { deadline: Date.now() - 1 }));
  check(
    "a deadline already in the past fails immediately with deadline_exceeded",
    asClockedError(past.err)?.code === "deadline_exceeded",
    past.err,
  );
  check("no HTTP attempt is made once the budget is gone", calls.length === 0, calls.length);

  calls = [];
  responders = [hang];
  const hangStart = Date.now();
  const hung = await captureError(verify(verifyPayload, { deadline: hangStart + 250 }));
  const hangElapsed = Date.now() - hangStart;
  check(
    "a hanging endpoint aborts at the deadline, not at the 120 s client timeout",
    asClockedError(hung.err)?.code === "deadline_exceeded",
    hung.err,
  );
  check(
    "the abort lands on the budget (~250 ms), far under maxDuration",
    hangElapsed >= 230 && hangElapsed <= 2000,
    hangElapsed,
  );

  calls = [];
  responders = [throttled("0"), throttled("0"), ok(okRerankBody)];
  const retried = await captureError(rerank(rerankPayload, { deadline: Date.now() + 10_000 }));
  check("429s then success under a generous deadline still succeed", retried.err === null, retried.err);
  check("all MAX_ATTEMPTS were used", (retried.value as ClockedCall<unknown> | null)?.attempts === 3, retried.value);
  check(
    "the idempotency key is reused verbatim across retries",
    calls.length === 3 && new Set(calls.map((c) => c.idempotencyKey)).size === 1,
    calls.map((c) => c.idempotencyKey),
  );

  calls = [];
  responders = [throttled("5")]; // Retry-After: 5 s, but the budget has < 1 s left
  const tightStart = Date.now();
  const tight = await captureError(compare(comparePayload, { deadline: tightStart + 800 }));
  const tightElapsed = Date.now() - tightStart;
  check(
    "a 429 whose backoff cannot fit the budget gives up as deadline_exceeded",
    asClockedError(tight.err)?.code === "deadline_exceeded",
    tight.err,
  );
  check("no retry attempt is started once the backoff cannot fit", calls.length === 1, calls.length);
  check("the give-up is immediate, not after waiting out the 5 s Retry-After", tightElapsed < 1500, tightElapsed);

  calls = [];
  responders = [throttled("0")];
  const exhausted = await captureError(rerank(rerankPayload, { deadline: Date.now() + 10_000 }));
  check(
    "persistent 429s still exhaust MAX_ATTEMPTS and surface http_429",
    asClockedError(exhausted.err)?.code === "http_429" && asClockedError(exhausted.err)?.status === 429,
    exhausted.err,
  );
  check("exactly three attempts were made", calls.length === 3, calls.length);

  calls = [];
  responders = [httpStatus(400)];
  const badRequest = await captureError(verify(verifyPayload, { deadline: Date.now() + 10_000 }));
  check(
    "a non-retryable 400 still surfaces immediately with budget remaining",
    asClockedError(badRequest.err)?.code === "http_400" && calls.length === 1,
    { err: badRequest.err, calls: calls.length },
  );

  calls = [];
  responders = [ok(okRerankBody)];
  const noDeadline = await captureError(rerank(rerankPayload));
  check("a call without a deadline keeps today's behavior (single attempt succeeds)", noDeadline.err === null && calls.length === 1, noDeadline.err);

  console.log("2) Triage — budget/timeout failures are analysis_incomplete, never a verdict or conflict");

  check(
    "deadline_exceeded is classified retryable-later",
    isRetryableError({ code: "deadline_exceeded" }),
  );

  const conflictCase = getCase("conflict")!;
  const registry = buildRegistry(conflictCase.docs);
  const usable: JoinedRerankResult = {
    index: 0,
    id: registry[0].id,
    action: "use",
    relevance_score: 0.99,
    document_score: 0.99,
    passage: registry[0] as PassageEntry,
  };
  const supportedClaim: VerifyClaim = {
    claim: "Claim A",
    supported: 0.95,
    contradicted: 0.03,
    not_stated: 0.01,
    not_a_claim: 0.01,
    verdict: "supported",
    evidence: { document: "doc-sp21", quote: "…", start: 0, end: 10, confidence: 0.9 },
  };
  const okInputs = (over: Partial<Parameters<typeof computeTriage>[0]> = {}) => ({
    rerankOk: true,
    rerankResults: [usable],
    verifyOk: true,
    claims: [supportedClaim],
    answersQuestion: 0.96,
    compareOk: true,
    pairs: [{ a: "doc-sp21", b: "doc-dhs13", relation: "overlapping" as const, related: 0.9 }],
    conflictIndexes: [],
    ...over,
  });

  const control = computeTriage(okInputs());
  check("control inputs still triage ready_for_review", control.state === "ready_for_review", control.state);

  const deadlineRun = computeTriage(
    okInputs({ verifyOk: false, verifyError: { code: "deadline_exceeded", message: "grounding gave up: the run's time budget is exhausted" } }),
  );
  check("Verify deadline => analysis_incomplete", deadlineRun.state === "analysis_incomplete", deadlineRun.state);
  check(
    "reason says retry later and explicitly not a source conflict",
    deadlineRun.reasons[0].includes("Analysis incomplete — retry later") &&
      deadlineRun.reasons.some((r) => r.includes("not a source conflict")),
    deadlineRun.reasons,
  );

  const deadlinePlusConflict = computeTriage(
    okInputs({
      verifyOk: false,
      verifyError: { code: "deadline_exceeded", message: "grounding gave up: the run's time budget is exhausted" },
      pairs: [{ a: "doc-sp21", b: "doc-rs26", relation: "conflicting" as const, related: 0.98 }],
      conflictIndexes: [0],
    }),
  );
  check(
    "a deadline failure outranks a flagged conflicting pair (never conflict_needs_decision)",
    deadlinePlusConflict.state === "analysis_incomplete",
    deadlinePlusConflict.state,
  );

  const allDeadline = computeTriage(
    okInputs({
      rerankOk: false,
      rerankError: { code: "deadline_exceeded", message: "rerank gave up" },
      verifyOk: false,
      verifyError: { code: "deadline_exceeded", message: "grounding gave up" },
      compareOk: false,
      compareError: { code: "deadline_exceeded", message: "compare gave up" },
    }),
  );
  check("all three core calls out of budget => analysis_incomplete", allDeadline.state === "analysis_incomplete", allDeadline.state);

  const throttledRun = computeTriage(
    okInputs({ rerankOk: false, rerankError: { code: "http_429", message: "rerank returned HTTP 429" } }),
  );
  check("429 still maps to analysis_incomplete", throttledRun.state === "analysis_incomplete", throttledRun.state);

  check(
    "TRIAGE_META labels the incomplete state retry-later and not-a-conflict, budget included",
    TRIAGE_META.analysis_incomplete.title.includes("retry later") &&
      TRIAGE_META.analysis_incomplete.blurb.includes("not a source conflict") &&
      TRIAGE_META.analysis_incomplete.blurb.includes("time budget"),
    TRIAGE_META.analysis_incomplete,
  );

  console.log("3) Route budget configuration (source guard)");

  const routeSrc = readFileSync("src/app/api/analyze/route.ts", "utf8");
  const maxDuration = Number(routeSrc.match(/export const maxDuration = (\d+)/)?.[1]);
  const budgetRaw = routeSrc.match(/const ANALYSIS_BUDGET_MS = ([\d_]+);/)?.[1];
  const budget = budgetRaw ? Number(budgetRaw.replace(/_/g, "")) : NaN;
  check("route keeps maxDuration = 60", maxDuration === 60, maxDuration);
  check("the run budget is configured", Number.isFinite(budget), budgetRaw);
  check("the run budget is at most 50 s", budget <= 50_000, budget);
  check(
    "at least 10 s of margin between the budget and maxDuration",
    maxDuration * 1000 - budget >= 10_000,
    { maxDuration, budget },
  );
  const callSites = (routeSrc.match(/\b(?:rerank|verify|compare)\(/g) ?? []).length;
  const deadlineSites = (routeSrc.match(/\{ deadline \}/g) ?? []).length;
  check(
    "every Clocked call site in the route (3 core + lookups) passes the deadline",
    callSites >= 4 && deadlineSites === callSites,
    { callSites, deadlineSites },
  );
  check(
    "enrichment is gated on all three core calls being ok",
    /const coreOk = rerankOk && verifyOk && compareOk/.test(routeSrc) && /coreOk && w < lookupTargets\.length/.test(routeSrc),
  );
  check(
    "a lookup wave is skipped when the remaining budget is short",
    /deadline - Date\.now\(\) < ENRICHMENT_MIN_REMAINING_MS\) break/.test(routeSrc),
  );
  } finally {
    clearInterval(keepAlive);
  }
}

main()
  .catch((err) => {
    failures += 1;
    console.log(`  FAIL: check script crashed — ${err instanceof Error ? err.stack : String(err)}`);
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    console.log("");
    console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
