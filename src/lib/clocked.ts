// ProofBrief — server-side Clocked API client.
// The account API key is read from the environment and never leaves the server.
// Each logical request carries a fresh UUID idempotency key; the same key is
// reused with the identical payload when retrying an unknown outcome, per the
// platform's authentication guidance.

const BASE_URL = "https://clocked.rezolve.ai/clocked";
const TIMEOUT_MS = 120_000;

export class ClockedError extends Error {
  code: string;
  status: number;
  detail?: string;
  /** Server-provided wait hint (ms) from a Retry-After header, when present. */
  retryAfterMs?: number;

  constructor(code: string, message: string, status = 0, detail?: string, retryAfterMs?: number) {
    super(message);
    this.name = "ClockedError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

/** True when retrying the same logical request could still succeed. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ClockedError) {
    // 429 = wait (the platform's throttling signal); 5xx = transient server
    // state. Other 4xx (bad request, auth, unprocessable) will not change on
    // retry and must surface immediately.
    return err.status === 429 || err.status >= 500;
  }
  return true; // network / timeout errors
}

/** Error class that means "wait and retry, do not parallelize". */
export function isThrottled(err: unknown): boolean {
  return err instanceof ClockedError && err.status === 429;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.CLOCKED_API_KEY);
}

async function postOnce<T>(
  endpoint: string,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  const key = process.env.CLOCKED_API_KEY;
  if (!key) {
    throw new ClockedError(
      "missing_key",
      "CLOCKED_API_KEY is not configured on the server. Add it to .env and restart.",
    );
  }
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const retryAfterHeader = res.headers.get("retry-after");
    let retryAfterMs: number | undefined;
    if (res.status === 429 && retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (Number.isFinite(seconds) && seconds >= 0) {
        retryAfterMs = Math.min(seconds * 1000, 10_000);
      }
    }
    throw new ClockedError(
      `http_${res.status}`,
      `${endpoint} returned HTTP ${res.status}`,
      res.status,
      detail.slice(0, 500),
      retryAfterMs,
    );
  }
  return (await res.json()) as T;
}

/**
 * A completed logical request: the endpoint result plus call metadata for
 * the on-screen endpoint trace. The idempotency key is not a credential,
 * but only its first 8 characters are ever surfaced.
 */
export interface ClockedCall<T> {
  data: T;
  /** Idempotency key for this logical request; reused verbatim on retry. */
  idempotencyKey: string;
  /** Wall-clock latency of the whole logical request, including retry backoff. */
  latencyMs: number;
  /** HTTP attempts made (1 unless a retry happened). */
  attempts: number;
}

/**
 * POST with bounded retry on 429, 5xx, and network errors, per the platform's
 * limits guidance ("wait and retry; do not increase parallelism"). The
 * idempotency key is generated once per logical request and reused verbatim
 * on every retry, so a retry cannot double-charge or double-run. Backoff is
 * exponential with jitter, capped, and honors a server Retry-After hint;
 * after MAX_ATTEMPTS the error is thrown and the workflow fails closed.
 */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = [800, 2000];
const BACKOFF_CAP_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callClocked<T>(endpoint: string, body: unknown): Promise<ClockedCall<T>> {
  const idempotencyKey = crypto.randomUUID();
  const startedAt = Date.now();
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      const data = await postOnce<T>(endpoint, body, idempotencyKey);
      return { data, idempotencyKey, latencyMs: Date.now() - startedAt, attempts };
    } catch (err) {
      if (!isRetryable(err) || attempts >= MAX_ATTEMPTS) throw err;
      const hint = err instanceof ClockedError ? err.retryAfterMs : undefined;
      const base = hint ?? BASE_BACKOFF_MS[Math.min(attempts - 1, BASE_BACKOFF_MS.length - 1)];
      const jittered = base * (0.8 + Math.random() * 0.4); // ±20% jitter
      await sleep(Math.min(jittered, BACKOFF_CAP_MS));
    }
  }
}

// ---- Request/response shapes (fields we use; the API may return more) ----

export interface RerankResult {
  index: number;
  id?: string;
  action: "use" | "expand" | "skip";
  reason?: string;
  relevance_score: number;
  document_score: number;
  levels?: Record<string, number>;
}

export interface RerankResponse {
  model: string;
  results: RerankResult[];
  usage?: { input_tokens?: number };
}

export interface VerifyClaim {
  claim: string;
  kind?: string;
  counted?: boolean;
  weight?: number;
  supported: number;
  contradicted: number;
  not_stated: number;
  not_a_claim: number;
  verdict: string;
  source?: string | null;
  evidence?: {
    document: string;
    quote: string;
    start: number;
    end: number;
    confidence: number;
  } | null;
}

export interface VerifyResponse {
  model: string;
  grounded: number;
  ungrounded: number;
  verdict: string;
  threshold: number;
  claims: VerifyClaim[];
  answers_question?: number;
}

export interface CompareFinding {
  kind?: string;
  confidence?: number;
  a?: { document: string; quote: string; start: number; end: number; confidence?: number };
  b?: { document: string; quote: string; start: number; end: number; confidence?: number };
}

export interface ComparePair {
  a: string;
  b: string;
  relation: "same" | "overlapping" | "conflicting" | "unrelated";
  related: number;
  probabilities?: Record<string, number>;
  duplicates?: CompareFinding[];
  conflicts?: CompareFinding[];
}

export interface CompareResponse {
  model: string;
  verdict: string;
  pairs: ComparePair[];
  conflicts?: number[];
  duplicates?: number[];
}

// ---- Endpoint wrappers ----

export function rerank(payload: {
  query: string;
  documents: { id: string; text: string; title: string; metadata?: Record<string, string> }[];
  context?: unknown;
  instructions?: string;
  top_n?: number;
}): Promise<ClockedCall<RerankResponse>> {
  return callClocked<RerankResponse>("rerank", payload);
}

export function verify(payload: {
  documents: { id: string; text: string }[];
  answer: string;
  question?: string;
  instructions?: string;
  evidence?: "all" | "flagged" | "none";
}): Promise<ClockedCall<VerifyResponse>> {
  return callClocked<VerifyResponse>("grounding", payload);
}

export function compare(payload: {
  documents: { id: string; text: string }[];
  instructions?: string;
  kinds?: boolean;
  evidence?: "all" | "flagged" | "none";
}): Promise<ClockedCall<CompareResponse>> {
  return callClocked<CompareResponse>("compare", payload);
}
