# ProofBrief (working title)

**Evidence review for draft replies.** A reviewer brings a customer question and a draft reply; ProofBrief checks every claim of that draft against the company's own documents, attaches the supporting passage to each claim, surfaces conflicts between the documents themselves, and exports an evidence packet for a human to decide. **Nothing is sent, and nothing is claimed as "true"** — verdicts describe support in the supplied documents, nothing more.

Entry for the [Clocked Build Challenge 2026](https://clocked.rezolve.ai/challenge), category **Best Use of Verify, Compare, or Rerank**.

> "ProofBrief" is a working title. A preliminary search surfaced no same-name product in this space; a full domain/trademark screen is still pending. ReplyAudit, SafeReply, and CiteDesk are held as alternates.

## What it does

```
 question ──┐
 draft ─────┤
 documents ─┴─► passage registry ──► Clocked Rerank ──► passage shortlist (use / expand / skip + reasons)
                    │                        │
                    ├──► Clocked Verify ──► claim ledger (supported / contradicted / not_stated + evidence quotes)
                    │                        │     + answers_question (relevance gate)
                    └──► Clocked Compare ─► source cross-check (pairwise relations + paired conflict passages)
                                                    │
                                                    ▼
                                    triage: ready for review / conflict needs a decision /
                                    missing evidence / review required / analysis incomplete (retry)
                                                    │
                                                    ▼
                                    evidence packet export (Markdown + raw JSON) — human decides
```

Every review state is computed **only** from live endpoint outputs. Errors, missing evidence, unusable results, and unanswered questions are treated as review-required, never as approval. No endpoint's result stands in for another's: Rerank selects, Verify grounds, Compare cross-checks.

## Quick start

```bash
# 1. install
bun install        # or: npm install

# 2. configure — add your Clocked account API key
cp .env.example .env
#   then edit .env and set CLOCKED_API_KEY=...

# 3. run
bun run dev        # or: npm run dev
```

Open http://localhost:3000, pick one of the five synthetic cases, and press **Run evidence check**. The three Clocked endpoints are called live; nothing on the results screen is faked. Without a key, the app shows an explicit error state rather than mock output.

**Requirements:** **Node 20.9+** (Next.js 16 requirement; the repo pins `engines.node >= 20.9.0`) or Bun 1.1+, and a Clocked account API key. The key is read only in the server route (`/api/analyze` → `src/lib/clocked.ts`); it is never shipped to the browser.

## The five synthetic cases

| Case | Scenario | What it demonstrates |
|---|---|---|
| Fully supported | Draft matches both policy documents | Ready-for-review state, every claim with evidence quote and offsets |
| True conflict | Two documents state 12 vs 24 months for the same subject, same scope | Compare flags the pair with paired passages; Verify contradicts the claim; approval blocked |
| Missing evidence | Draft claims at-rest encryption + ISO 27001; no source states either | Claims surface as *not established by these sources* — never as false |
| Different-scope numbers | 12 months for audit logs vs 7 years for backups | The trap case: differing numbers over different scopes should **not** be a conflict. If Compare flags it anyway, the conflict card routes to human resolution — the designed fallback |
| Accurate but off-topic | Every claim supported, but the draft answers a different question | The relevance gate: grounding and `answers_question` are separate Verify signals; a grounded-but-irrelevant draft routes to a human, never to ready |

All companies, documents, people, and figures are synthetic. No real customer data appears anywhere in this repository.

## How the endpoints are used

| Stage | Endpoint | What the reviewer sees |
|---|---|---|
| Passage selection | **Rerank** (`/clocked/rerank`) | Ranked shortlist with `use` / `expand` / `skip` actions, skip reasons, relevance and document scores — each result joined by id back to the registry excerpt |
| Claim grounding | **Verify** (`/clocked/grounding`) | Claim ledger: per-claim verdict, probability bars, evidence quote with document, character offsets, and confidence; aggregate grounded score; the separate `answers_question` relevance score gates the triage |
| Source cross-check | **Compare** (`/clocked/compare`) | Pairwise relations with paired conflict passages, finding kinds, and confidence |
| Triage | app logic over outputs | One of five states; conflicts block approval; the reasons cite the exact outputs |
| Export | app | Markdown + JSON evidence packet; the app has no send control |

Integration details worth noting:

- **Relevance gate.** Verify returns `answers_question` (0–1, only when a question is supplied) separately from per-claim grounding: a draft can be fully supported by the sources and still answer the wrong question. Below 0.5 the triage returns review-required with the score in the reason; a missing score fails closed the same way. In the off-topic case the live endpoint scored the draft 0.006 while marking both claims supported — exactly the separation the gate exists for.
- **Runtime validation, fail closed.** Every endpoint response is validated against the documented shape at runtime (zod): verdict/action/relation enum allowlists, 0–1 scores, integer offsets, end ≥ start. Anything unexpected makes that endpoint count as failed (`invalid_response`) and the run can never be ready-for-review from an ununderstood output. TypeScript casts alone check nothing at runtime.
- **Passage registry.** Rerank results carry no text ("Join them back to your documents by index or id"), so passages are registered with ids, sections, and character offsets before any call (`src/lib/registry.ts`) and joined back for display. A `use` result that joins to no registry passage (unknown id, out-of-range index) does not count as a source basis.
- **Idempotency and backoff.** Every logical request gets a fresh UUID `Idempotency-Key`; retries reuse the same key with the identical payload, per the platform's guidance. On 429 / 5xx / network errors the client retries up to 3 attempts with exponential backoff (800 ms / 2 s base, ±20% jitter, 8 s cap), honoring a `Retry-After` hint — wait and retry, never add parallelism.
- **Concurrency guard.** A run fires the three core calls in parallel and the Clocked build tier allows 4 concurrent requests, so the route runs **one analysis at a time per instance** plus a 4 s per-IP cooldown; over the cap it answers 429 `busy` so the client can retry. A retryable failure (429 / 5xx / network) after backoff lands in a distinct **analysis incomplete — retry later** state, labeled "not a source conflict and not a verdict"; non-retryable errors and validation failures stay review-required. The in-memory cap is per serverless instance — a durable limit would need shared storage.
- **Endpoint trace.** Every run records each live call — path, purpose, latency, model, input tokens, idempotency-key prefix, attempt count — and shows it on the review screen; the evidence-packet export includes it. The integration is visible, not implied.
- **Nearest-source lookups.** For claims Verify returns `not_stated` — and for supported or contradicted claims that come back with no evidence quote — a follow-up Rerank call (claim as query, `top_n: 3`) shows the nearest passages the sources contain, so a claim is never left with nothing to look at. The claim card leads with "No direct Verify evidence was returned for this claim" and labels the passage a relevance match — enrichment, not proof. It never replaces a Verify verdict and never changes the review state. A failed lookup appears in the trace; the core-call error rule (any core-call error → review required / analysis incomplete) stays absolute.
- **Contradiction cross-link.** When Verify contradicts a claim and Compare has flagged a conflicting pair involving the claim's evidence document, the claim card also shows the opposing side's paired passage, attributed to Compare and linked to the full pair — the reviewer sees both sides of the conflict at the claim itself.
- **Extraction context.** Endpoint quotes are verbatim extractions and can be as short as a section heading. Each Compare finding quote is displayed with the surrounding source section (located by character offsets), so a heading-only extraction is never mistaken for the whole evidence; the raw extraction and its offsets stay visible in a note, and offsets for an expanded section are shown only beside the raw extraction they belong to.
- **Rerank gates the review.** If no passage comes back with action `use`, there is no source basis to check the draft against, and the run cannot be ready-for-review — whatever any other endpoint says. In the missing-evidence case this is exactly what happens: all six passages are skipped as `unrelated`.
- **Instructions define scope.** The Compare instructions encode the "same entity, period, and scope" rule, and the Verify instructions forbid outside knowledge and separate transport from at-rest encryption.
- **Language contract.** The UI says *supported by these documents*, never *verified true*; *not established by these sources*, never *false*.

## Repo layout

```
src/
  app/page.tsx                 the single review screen
  app/api/analyze/route.ts     orchestrates the live calls (validation, concurrency guard, 3 core + follow-up lookups)
  app/api/route.ts             GET /api health check (reports whether a key is configured)
  lib/cases.ts                 five synthetic cases (question, draft, documents, context)
  lib/registry.ts              passage registry: ids, sections, character offsets + quote resolution
  lib/clocked.ts               server-side Clocked client: idempotency, bounded 429/5xx backoff
  lib/validate.ts              runtime response validation (zod, fail closed)
  lib/analysis.ts              triage logic driven only by endpoint outputs + trace types
  lib/export.ts                evidence-packet Markdown builder (same quote resolution as the UI)
  lib/display.ts               display labels honoring the language contract
  components/proofbrief/       case selector, triage banner, endpoint trace, endpoint cards, export
docs/
  test-log.md                  expected vs observed per case (filled by real runs)
scripts/
  check-display-fixes.ts       offline checks vs saved live outputs (quote resolution, opposing side)
  check-export-fix.ts          offline checks for the exported packet
  check-hardening.ts           offline checks: relevance gate, validation, incomplete state, offsets
  check-time-budget.ts         offline checks: deadline expiry, retryable 429/timeout, run-budget invariant
  check-source-integrity.ts    offline checks: reference integrity (rerank id join, evidence/pair refs, remap)
```

## Demo script (60–90 s)

1. **(10 s)** One screen: question, draft reply, sources. "Before this reply goes anywhere, we check every claim against our own documents."
2. **(15 s)** Case 1 *Fully supported* → Run evidence check → the endpoint trace shows three live calls; the claim ledger shows both claims supported with quotes and offsets; ready for review → export the evidence packet.
3. **(20 s)** Case 2 *True conflict* → Compare flags 12 vs 24 months for the same subject with paired passages; the claim is contradicted; approval is blocked until a human decides.
4. **(15 s)** Case 5 *Accurate but off-topic* → every claim is supported, the sources agree — and yet the draft answers the wrong question. Verify scored answers_question at 0.006; the review state says a human must decide whether to rewrite. Grounding and relevance are separate signals, and both gates matter.
5. **(15 s)** Case 3 *Missing evidence* → nothing in the sources establishes AES-256 at rest or ISO 27001; Rerank skipped every passage; the nearest-source lookup shows the sources have nothing close; *not established*, never *false*.
6. **(10 s)** Case 4 *Different-scope numbers* → 12 months for audit logs vs 7 years for backups: different subjects, so not a conflict. Compare returns `unrelated`; the observed result is recorded in the test log either way.
7. **(10 s)** Close on the language contract: *supported by these documents*; the app has no send button — a human decides.

## Test log

See [`docs/test-log.md`](docs/test-log.md). Expected outcomes are written per case per endpoint; **observed outcomes are recorded from real runs and never hardcoded** — including the different-scope trap case, where either a clean pass or a flagged pair routed to human resolution is an acceptable, documented result. Six live runs are recorded through 2026-11-07, the latest a post-deploy smoke of the reference-integrity build on the deployed commit `4628f8c`: all five documented states reproduced with the new reference gates silent on real endpoint output (off-topic draft: grounded 1.00, answers_question 0.006, review_required).

## Known limitations

- **This is a prototype for a fixed set of demo cases, not a general-purpose tool.** It reviews one question, one draft reply, and two source documents per run, from a fixed synthetic case list. Arbitrary customer replies and uploaded documents — with the privacy, retention, and consent story they require — are future work and are deliberately not in this build. Vendors already sell AI-drafted questionnaire answers with citations; the claim to judge here is not "AI with citations" but the review surface: per-claim verdicts with attached evidence, source-conflict detection, explicit uncertainty, a relevance gate, and an exportable evidence packet that ends in a human decision.
- **No send path.** The workflow ends at ready-for-review plus an evidence-packet export. Delivering replies (email, ticket, portal) is intentionally absent.
- **No database.** Cases are static synthetic data; runs are not persisted server-side. The evidence packet is the durable artifact.
- **Endpoint semantics.** Verify "measures support in supplied sources, not truth in the outside world"; the same caution applies to every verdict shown here. A model can judge support incorrectly, so high-impact claims deserve stricter human review — which is the entire point of the approval gate.
- **Relevance threshold is a policy choice.** The 0.5 cutoff on `answers_question` mirrors the platform's default grounding threshold, not a measured optimum; the score is shown on screen and in the packet so a human can disagree with the gate.
- **Concurrency cap is per instance.** The one-analysis-at-a-time guard lives in module state, so on serverless each instance enforces it independently; a durable, account-wide limit would need shared storage. 429s from Clocked or from this guard both land in the same "analysis incomplete — retry later" state.
- **Trap case is a test, not a guarantee.** Whether Compare declines to flag the different-scope pair is up to the endpoint; the app handles both outcomes, and the observed result goes into the test log.
- **Dependency advisories (triaged).** `bun audit` reports advisories in build/dev toolchain packages pulled in by the Next.js/eslint/browserslist chain and by sharp's bundled libvips — none on the app's runtime request path (the deployed route executes next/react/radix/zod code only). Unused scaffold dependencies carrying advisories (next-auth with a critical, prisma, uuid, next-intl) were removed; the rest were updated within semver. A full scaffold prune is post-challenge work.
- **Name not fully cleared.** "ProofBrief" is a working title pending domain/trademark screening.
- **Credits.** Each run makes three live core requests plus up to four follow-up lookups (when claims are not established or carry no evidence quote); a run retries at most twice per logical request on 429/5xx with the same idempotency key. A quick `curl <host>/api` returns the health check, including whether a key is configured.

## Compliance notes

- Fresh codebase started inside the challenge window (October 21 – November 10, 2026); public history is consistent with that.
- All demo data is synthetic (required: public, synthetic, or authorized data only).
- The API key lives in `.env` (gitignored) and is read only on the server. `.env.example` documents the variable; no secret is ever committed.
- No existing product's name, branding, copy, code, or assets are used. Products in the same category (Conveyor, SafeBase, Vanta, Loopio, Responsive, ReplyProof) are market references only.
- Built with AI coding assistance, which the challenge explicitly permits; the entry lists only eligible humans.

## Deploying the demo

Any Node 20.9+ host works. On Vercel:

1. Import the repo; the framework is auto-detected (Next.js).
2. Set the environment variable `CLOCKED_API_KEY` (Project → Settings → Environment Variables) for Production and Preview.
3. Deploy. `next build` runs with TypeScript checking enabled (no bypass); there is no Prisma step — the app uses no database.

Local checks before shipping: `bun run lint` · `bunx tsc --noEmit` · `bun run build` · the five offline suites in `scripts/` (`check-display-fixes.ts`, `check-export-fix.ts`, `check-hardening.ts`, `check-time-budget.ts`, `check-source-integrity.ts`).

Keep the demo and this repository accessible through **November 18, 2026**.
