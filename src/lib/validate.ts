// ProofBrief — runtime validation of Clocked endpoint responses.
//
// The API contract is documented (clocked.rezolve.ai/docs), but a live service
// can return shapes we do not expect: an unknown claim verdict, a rerank
// action outside the allowlist, a compare relation we have never seen, or a
// score outside 0–1. TypeScript casts do not check anything at runtime. Every
// response is therefore validated here before it is used, and anything
// unexpected FAILS CLOSED: the endpoint counts as not-ok and the review state
// becomes review-required (never "ready") — an ununderstood output must never
// be displayed as a verdict.
//
// Fields ProofBrief does not read are not enforced (extra fields are ignored),
// so a newer API adding fields cannot break the demo; only the values the
// workflow depends on are allowlisted.

import { z } from "zod";

const prob = z.number().min(0).max(1);
const intOff = z.number().int();

// ---- Verify (grounding) ----

const evidenceSchema = z
  .object({
    document: z.string(),
    quote: z.string(),
    start: intOff,
    end: intOff,
    confidence: prob,
  })
  .refine((e) => e.end >= e.start, { message: "end offset precedes start offset" });

export const VERIFY_CLAIM_VERDICTS = ["supported", "contradicted", "not_stated", "not_a_claim"] as const;

const verifyClaimSchema = z.object({
  claim: z.string(),
  kind: z.string().optional(),
  counted: z.boolean().optional(),
  weight: z.number().optional(),
  supported: prob,
  contradicted: prob,
  not_stated: prob,
  not_a_claim: prob,
  verdict: z.enum(VERIFY_CLAIM_VERDICTS),
  source: z.string().nullable().optional(),
  evidence: evidenceSchema.nullable().optional(),
});

const verifyResponseSchema = z.object({
  model: z.string(),
  grounded: prob,
  ungrounded: prob.optional(),
  verdict: z.string(),
  threshold: prob,
  claims: z.array(verifyClaimSchema),
  // Relevance signal, separate from grounding: returned only when a question
  // was supplied (it always is here). Validated as a probability; absence is
  // handled by the triage gate, which fails closed on a missing score.
  answers_question: prob.optional(),
});

// ---- Rerank ----

export const RERANK_ACTIONS = ["use", "expand", "skip"] as const;

const rerankResultSchema = z.object({
  index: z.number().int().min(0),
  id: z.string().optional(),
  action: z.enum(RERANK_ACTIONS),
  reason: z.string().optional(),
  relevance_score: prob,
  document_score: prob,
});

const rerankResponseSchema = z.object({
  model: z.string(),
  results: z.array(rerankResultSchema),
  usage: z.object({ input_tokens: z.number().optional() }).optional(),
});

// ---- Compare ----

const compareFindingSideSchema = z
  .object({
    document: z.string(),
    quote: z.string(),
    start: intOff,
    end: intOff,
    confidence: prob.optional(),
  })
  .refine((s) => s.end >= s.start, { message: "end offset precedes start offset" });

const compareFindingSchema = z.object({
  kind: z.string().optional(),
  confidence: prob.optional(),
  a: compareFindingSideSchema.optional(),
  b: compareFindingSideSchema.optional(),
});

export const COMPARE_RELATIONS = ["same", "overlapping", "conflicting", "unrelated"] as const;

const comparePairSchema = z.object({
  a: z.string(),
  b: z.string(),
  relation: z.enum(COMPARE_RELATIONS),
  related: prob,
  probabilities: z.record(z.string(), z.number()).optional(),
  duplicates: z.array(compareFindingSchema).optional(),
  conflicts: z.array(compareFindingSchema).optional(),
});

const compareResponseSchema = z.object({
  model: z.string(),
  verdict: z.string(),
  pairs: z.array(comparePairSchema),
  conflicts: z.array(z.number().int()).optional(),
  duplicates: z.array(z.number().int()).optional(),
});

// ---- Result type ----

export type ValidationResult = { ok: true } | { ok: false; message: string };

function run(schema: z.ZodTypeAny, data: unknown): ValidationResult {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true };
  const issue = parsed.error.issues[0];
  const path = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
  return {
    ok: false,
    message: `unexpected value for ${issue?.code ?? "unknown"}${path}: ${issue?.message ?? "response did not match the documented shape"}`,
  };
}

export function validateRerankResponse(data: unknown): ValidationResult {
  return run(rerankResponseSchema, data);
}

export function validateVerifyResponse(data: unknown): ValidationResult {
  return run(verifyResponseSchema, data);
}

export function validateCompareResponse(data: unknown): ValidationResult {
  return run(compareResponseSchema, data);
}
