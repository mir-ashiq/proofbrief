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

  constructor(code: string, message: string, status = 0, detail?: string) {
    super(message);
    this.name = "ClockedError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
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
    throw new ClockedError(`http_${res.status}`, `${endpoint} returned HTTP ${res.status}`, res.status, detail.slice(0, 500));
  }
  return (await res.json()) as T;
}

/**
 * POST with one retry on network errors or 5xx. The idempotency key is
 * generated once per logical request and reused verbatim on the retry,
 * so a timeout cannot double-charge or double-run.
 */
async function callClocked<T>(endpoint: string, body: unknown): Promise<T> {
  const idempotencyKey = crypto.randomUUID();
  try {
    return await postOnce<T>(endpoint, body, idempotencyKey);
  } catch (err) {
    const retryable =
      err instanceof ClockedError ? err.status >= 500 : true; // network/timeout errors
    if (!retryable) throw err;
    await new Promise((r) => setTimeout(r, 2000));
    return await postOnce<T>(endpoint, body, idempotencyKey);
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
}): Promise<RerankResponse> {
  return callClocked<RerankResponse>("rerank", payload);
}

export function verify(payload: {
  documents: { id: string; text: string }[];
  answer: string;
  question?: string;
  instructions?: string;
  evidence?: "all" | "flagged" | "none";
}): Promise<VerifyResponse> {
  return callClocked<VerifyResponse>("grounding", payload);
}

export function compare(payload: {
  documents: { id: string; text: string }[];
  instructions?: string;
  kinds?: boolean;
  evidence?: "all" | "flagged" | "none";
}): Promise<CompareResponse> {
  return callClocked<CompareResponse>("compare", payload);
}
