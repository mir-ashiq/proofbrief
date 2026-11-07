# ProofBrief (working title)

**Evidence review for draft replies.** A reviewer brings a customer question and a draft reply; ProofBrief checks every claim of that draft against the company's own documents, attaches the supporting passage to each claim, surfaces conflicts between the documents themselves, and exports an evidence packet for a human to decide. **Nothing is sent, and nothing is claimed as "true"** — verdicts describe support in the supplied documents, nothing more.

Entry for the [Clocked Build Challenge 2026](https://clocked.rezolve.ai/challenge), category **Best Use of Verify, Compare, or Rerank**.

> "ProofBrief" is a working title. A preliminary search surfaced no same-name product in this space; a full domain/trademark screen is still pending. ReplyAudit, SafeReply, and CiteDesk are held as alternates.

## What it does

```
 question ──┐
 draft ─────┤
 documents ─┴─► passage registry ──► Clocked Rerank ──► passage shortlist (use / expand / skip + reasons)
                    │
                    ├──► Clocked Verify ──► claim ledger (supported / contradicted / not_stated + evidence quotes)
                    │
                    └──► Clocked Compare ─► source cross-check (pairwise relations + paired conflict passages)
                                                    │
                                                    ▼
                                    triage: ready for review / conflict needs a decision /
                                    missing evidence / review required
                                                    │
                                                    ▼
                                    evidence packet export (Markdown + raw JSON) — human decides
```

Every review state is computed **only** from live endpoint outputs. Errors, missing evidence, and unusable results are treated as review-required, never as approval. No endpoint's result stands in for another's: Rerank selects, Verify grounds, Compare cross-checks.

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

Open http://localhost:3000, pick one of the four synthetic cases, and press **Run evidence check**. The three Clocked endpoints are called live; nothing on the results screen is faked. Without a key, the app shows an explicit error state rather than mock output.

**Requirements:** Node 18+ (or Bun), a Clocked account API key. The key is read only in the server route (`/api/analyze` → `src/lib/clocked.ts`); it is never shipped to the browser.

## The four synthetic cases

| Case | Scenario | What it demonstrates |
|---|---|---|
| Fully supported | Draft matches both policy documents | Ready-for-review state, every claim with evidence quote and offsets |
| True conflict | Two documents state 12 vs 24 months for the same subject, same scope | Compare flags the pair with paired passages; Verify contradicts the claim; approval blocked |
| Missing evidence | Draft claims at-rest encryption + ISO 27001; no source states either | Claims surface as *not established by these sources* — never as false |
| Different-scope numbers | 12 months for audit logs vs 7 years for backups | The trap case: differing numbers over different scopes should **not** be a conflict. If Compare flags it anyway, the conflict card routes to human resolution — the designed fallback |

All companies, documents, people, and figures are synthetic. No real customer data appears anywhere in this repository.

## How the endpoints are used

| Stage | Endpoint | What the reviewer sees |
|---|---|---|
| Passage selection | **Rerank** (`/clocked/rerank`) | Ranked shortlist with `use` / `expand` / `skip` actions, skip reasons, relevance and document scores — each result joined by id back to the registry excerpt |
| Claim grounding | **Verify** (`/clocked/grounding`) | Claim ledger: per-claim verdict, probability bars, evidence quote with document, character offsets, and confidence; aggregate grounded score |
| Source cross-check | **Compare** (`/clocked/compare`) | Pairwise relations with paired conflict passages, finding kinds, and confidence |
| Triage | app logic over outputs | One of four states; conflicts block approval; the reasons cite the exact outputs |
| Export | app | Markdown + JSON evidence packet; the app has no send control |

Integration details worth noting:

- **Passage registry.** Rerank results carry no text ("Join them back to your documents by index or id"), so passages are registered with ids, sections, and character offsets before any call (`src/lib/registry.ts`) and joined back for display.
- **Idempotency.** Every logical request gets a fresh UUID `Idempotency-Key`; a retry after an unknown outcome reuses the same key with the identical payload, per the platform's guidance.
- **Endpoint trace.** Every run records each live call — path, purpose, latency, model, input tokens, idempotency-key prefix — and shows it on the review screen; the evidence-packet export includes it. The integration is visible, not implied.
- **Nearest-source lookups.** For claims Verify returns `not_stated`, a follow-up Rerank call (claim as query, `top_n: 3`) shows the passages the sources *do* contain, so a reviewer can see the gap. This is display-only enrichment: it never replaces a Verify verdict and never changes the review state. A failed lookup appears in the trace; the core-call error rule (any core-call error → review required) stays absolute.
- **Rerank gates the review.** If no passage comes back with action `use`, there is no source basis to check the draft against, and the run cannot be ready-for-review — whatever any other endpoint says. In the missing-evidence case this is exactly what happens: all six passages are skipped as `unrelated`.
- **Instructions define scope.** The Compare instructions encode the "same entity, period, and scope" rule, and the Verify instructions forbid outside knowledge and separate transport from at-rest encryption.
- **Language contract.** The UI says *supported by these documents*, never *verified true*; *not established by these sources*, never *false*.

## Repo layout

```
src/
  app/page.tsx                 the single review screen
  app/api/analyze/route.ts     orchestrates the live calls (3 core + follow-up lookups)
  app/api/route.ts             GET /api health check (reports whether a key is configured)
  lib/cases.ts                 four synthetic cases (question, draft, documents, context)
  lib/registry.ts              passage registry: ids, sections, character offsets
  lib/clocked.ts               server-side Clocked client with call metadata (key stays server-side)
  lib/analysis.ts              triage logic driven only by endpoint outputs + trace types
  lib/display.ts               display labels honoring the language contract
  components/proofbrief/       case selector, triage banner, endpoint trace, endpoint cards, export
docs/
  test-log.md                  expected vs observed per case (filled by real runs)
```

## Demo script (60–90 s)

1. **(10 s)** One screen: question, draft reply, sources. "Before this reply goes anywhere, we check every claim against our own documents."
2. **(15 s)** Case 1 *Fully supported* → Run evidence check → the endpoint trace shows three live calls; the claim ledger shows both claims supported with quotes and offsets; ready for review → export the evidence packet.
3. **(20 s)** Case 2 *True conflict* → Compare flags 12 vs 24 months for the same subject with paired passages; the claim is contradicted; approval is blocked until a human decides.
4. **(15 s)** Case 3 *Missing evidence* → nothing in the sources establishes AES-256 at rest or ISO 27001; Rerank skipped every passage; the nearest-source lookup shows the sources have nothing close; *not established*, never *false*.
5. **(15 s)** Case 4 *Different-scope numbers* → 12 months for audit logs vs 7 years for backups: different subjects, so not a conflict. Compare returns `unrelated`; the observed result is recorded in the test log either way.
6. **(10 s)** Close on the language contract: *supported by these documents*; the app has no send button — a human decides.

## Test log

See [`docs/test-log.md`](docs/test-log.md). Expected outcomes are written per case per endpoint; **observed outcomes are recorded from real runs and never hardcoded** — including the different-scope trap case, where either a clean pass or a flagged pair routed to human resolution is an acceptable, documented result. Run 1 (2026-11-07) is recorded there: Cases 1, 2, 3 matched expectations, and the trap case took the desired branch (no conflict flagged for different-scope numbers).

## Known limitations

- **Scope is deliberately narrow.** One question, one draft reply, and two source documents per case. Multi-question questionnaires, file upload/parsing, auth, and persistence are out of scope for this build.
- **No send path.** The workflow ends at ready-for-review plus an evidence-packet export. Delivering replies (email, ticket, portal) is intentionally absent.
- **No database.** Cases are static synthetic data; runs are not persisted server-side. The evidence packet is the durable artifact.
- **Endpoint semantics.** Verify "measures support in supplied sources, not truth in the outside world"; the same caution applies to every verdict shown here. A model can judge support incorrectly, so high-impact claims deserve stricter human review — which is the entire point of the approval gate.
- **Trap case is a test, not a guarantee.** Whether Compare declines to flag the different-scope pair is up to the endpoint; the app handles both outcomes, and the observed result goes into the test log.
- **Name not fully cleared.** "ProofBrief" is a working title pending domain/trademark screening.
- **Credits.** Each run makes three live core requests plus up to three follow-up lookups (only when claims are not established); with challenge credits this is well within budget, but the demo is not rate-limit-hardened. A quick `curl localhost:3000/api` returns the health check, including whether a key is configured.

## Compliance notes

- Fresh codebase started inside the challenge window (October 21 – November 10, 2026); public history is consistent with that.
- All demo data is synthetic (required: public, synthetic, or authorized data only).
- The API key lives in `.env` (gitignored) and is read only on the server. `.env.example` documents the variable; no secret is ever committed.
- No existing product's name, branding, copy, code, or assets are used. Products in the same category (Conveyor, SafeBase, Vanta, Loopio, Responsive, ReplyProof) are market references only.
- Built with AI coding assistance, which the challenge explicitly permits; the entry lists only eligible humans.

## Deploying the demo

Any Node host works (e.g. Vercel): set `CLOCKED_API_KEY` in the host's environment and deploy. Keep the demo and this repository accessible through **November 18, 2026**.
