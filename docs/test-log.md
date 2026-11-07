# ProofBrief — four-case test log

Expected outcomes below were written **before** running. Observed outcomes are recorded from real runs against the live Clocked endpoints and are **never hardcoded or edited to match expectations**. Model verdicts can vary between runs; that is a property of the platform, and this log exists to show the experiment honestly.

Run a case: start the app, select the case, press **Run evidence check**, then paste the observed summary below (or attach the exported JSON packet). The results below were produced through the app's own `/api/analyze` route — the same code path the UI uses, calling the live endpoints.

---

## Run 1 — 2026-11-07, 12:53 PM IST (07:23 UTC)

All four cases, back to back, through `POST /api/analyze` on a local dev server with a live `CLOCKED_API_KEY`. Model on every call: `clocked-1.0`.

### Case 1 — Fully supported (`supported`)

| Endpoint | Expected | Observed |
|---|---|---|
| Rerank | Audit-retention passages rank as `use`; unrelated sections (backups, incident response) are skipped with reasons | `doc-dhs13-s2` (retention of audit records) `use` 99%, `doc-sp21-s2` (audit log retention) `use`; all four other passages `skip` / `unrelated`. **Match.** |
| Verify | Both claims supported by these documents, with evidence quotes and offsets | grounded 0.9969; claim #1 `supported` (evidence: “Northwind retains customer audit logs for 12 months from the date of record…”, doc-sp21, chars 145–295); claim #2 `supported` (evidence: deletion sentence, same doc). **Match.** |
| Compare | Documents relate (both cover audit-log retention); no conflicting pair | `overlapping` (related 0.9982), 0 conflicts, roll-up `clean`. **Match.** |
| Triage | Ready for human review | `ready_for_review`. **Match.** |

Trace: Rerank 650 ms · Verify 704 ms · Compare 569 ms.

### Case 2 — True conflict (`conflict`)

| Endpoint | Expected | Observed |
|---|---|---|
| Rerank | Both audit-retention passages rank as `use`; the account-records section is skipped | `doc-rs26-s1` `use`, `doc-sp21-s2` `use`; account-records and the rest `skip` / `unrelated`. **Match.** |
| Verify | The 12-month claim is contradicted by at least one source; evidence points to both passages | grounded 0.6063; claim #1 (12 months) `contradicted` with evidence quote from doc-sp21; claim #2 (automatic permanent deletion) `supported`. **Match** — the contradiction surfaced exactly on the claim that carries the wrong number. |
| Compare | The audit-records pair is flagged conflicting with paired passages from both documents | `doc-sp21 ↔ doc-rs26` `conflicting` (related 0.9788); 1 finding, kind `value`: “audit logs … 12 months …” vs “Audit log records are retained for 24 months …”. Roll-up `conflicts`. **Match.** |
| Triage | Conflict — needs a human decision (approval blocked) | `conflict_needs_decision`, reasons cite both the flagged pair and the contradicted claim. **Match.** |

Trace: Rerank 309 ms · Verify 407 ms · Compare 620 ms.

### Case 3 — Missing evidence (`missing`)

| Endpoint | Expected | Observed |
|---|---|---|
| Rerank | Transit-encryption passages may rank as the closest available, or be skipped as not answering | At question level, **all six passages `skip` / `unrelated`** — nothing in the sources addresses at-rest encryption or ISO 27001. The follow-up nearest-source lookups (claim as query) returned top-3 passages all with action `skip`; for claim #1 the TLS-in-transit passage appeared among the nearest, marked skip. **Within expected range** (skipped as not answering). |
| Verify | Both claims `not_stated`: no source establishes them; the TLS 1.3 passage is about transport, not at-rest | grounded 0.0019; claim #1 (AES-256 at rest) `not_stated`, no evidence; claim #2 (ISO 27001) `not_stated`, no evidence. The TLS passage was **not** read as at-rest support. **Match.** |
| Compare | Documents relate on retention; no conflicting pair | `overlapping` (related 0.9982), 0 conflicts. **Match.** |
| Triage | Missing evidence — needs input | `missing_evidence`; reasons cite both the Rerank gate (no usable passage) and each not-established claim. **Match.** |

Trace: Rerank 360 ms · Verify 422 ms · Compare 317 ms · Rerank (nearest, claim #1) 390 ms · Rerank (nearest, claim #2) 535 ms.

### Case 4 — Different-scope numbers (`scope-trap`)

| Endpoint | Expected | Observed |
|---|---|---|
| Rerank | Audit-retention and backup-retention passages rank as `use` for their respective parts of the question | `doc-sp21-s2` (audit logs) `use`, `doc-brs20-s1` (backup retention) `use`; the rest `skip` / `unrelated`. **Match.** |
| Verify | Both claims supported by these documents | grounded 0.9967; claim #1 `supported` with evidence; claim #2 `supported` (no evidence passage returned — evidence is optional; the UI shows the no-evidence note rather than inventing a quote). **Match.** |
| Compare | **Desired:** no conflicting pair (different data types). **Fallback:** if flagged, routes to human resolution | `doc-sp21 ↔ doc-brs20` **`unrelated` (related 0.0054)**, 0 conflicts, roll-up `clean`. The 12-month audit-log rule and the 7-year backup-archive rule were **not** treated as a contradiction. **Desired outcome observed.** |
| Triage | Ready for human review (desired) or conflict needs a decision (fallback) | `ready_for_review`. **Desired branch.** |

Trace: Rerank 373 ms · Verify 420 ms · Compare 463 ms.

> The Compare documentation warns that “a document date or a differing number does not by itself establish a contradiction”; this run is the experiment that shows the instruction set working: same numbers differ in Case 2 (same subject, same scope → conflict) while different numbers in Case 4 (different subjects → no conflict).

---

## Deviations and notes from Run 1

- No endpoint errors, no retries. Every trace entry succeeded on the first attempt.
- Per-case wall time 0.5–1.0 s (three core calls in parallel, plus up to two follow-up lookups in Case 3).
- Verify evidence is sometimes absent even for a `supported` claim (Case 4, claim #2). The platform documents this (“Evidence is optional even when requested”); the UI renders the explicit no-evidence note instead of fabricating a passage.
- Case 3 demonstrated the Rerank gate: with no passage marked `use`, the review state cannot be ready-for-review regardless of what any other endpoint says.

---

## Run 2 — 2026-11-07, ~2:56 PM IST (09:26 UTC)

Run immediately after two evidence-display fixes (listed at the bottom). All four cases through `POST /api/analyze` with a live `CLOCKED_API_KEY`; model on every call `clocked-1.0`. Every expectation from Run 1 held, and all four triage states are identical to Run 1.

### Case 1 — Fully supported (`supported`)

grounded 0.9969 · answers question 0.99 · Compare `overlapping` (related 0.9982, roll-up `clean`) · triage `ready_for_review`. Rerank: `doc-dhs13-s2` and `doc-sp21-s2` `use` at 99% each; the other four passages skipped. Both claims supported with evidence quotes from doc-sp21. Trace: 615/755/705 ms. **No change from Run 1.**

### Case 2 — True conflict (`conflict`)

grounded 0.6063 · Compare `conflicting` (related 0.9788; one finding, kind `value`) · triage `conflict_needs_decision`. Claim #1 (12 months) `contradicted` at 0.9456 with the doc-sp21 evidence quote; claim #2 supported. Trace: 358/413/514 ms.

**Fix 1 observed:** the contradicted claim now also shows the *opposing* passage joined from the flagged pair — doc-rs26: "Audit log records are retained for 24 months from the date of record, then deleted." — attributed to the Compare cross-check and linked to the pair card. The pair finding's a-side quote itself came back as only the heading "## Audit log retention" (chars 186–208); the card now offers the surrounding section from the source document as context, so a heading-only extraction is no longer mistaken for the whole evidence.

### Case 3 — Missing evidence (`missing`)

grounded 0.0019 · Compare `overlapping` (related 0.9982, `clean`) · triage `missing_evidence`. All six passages skipped at question level; both claims `not_stated`; both nearest-source lookups returned all-skip top-3s. Trace: 351/427/304/369/325 ms. **No change from Run 1.**

### Case 4 — Different-scope numbers (`scope-trap`)

grounded 0.9967 · Compare `unrelated` (related 0.0054, roll-up `clean`) · triage `ready_for_review`. Claim #1 supported with evidence; claim #2 (7-year backup archives) supported **without** an evidence quote. Trace: 360/413/637/315 ms — four live calls, the fourth being the new lookup.

**Fix 2 observed:** the supported-but-unevidenced claim now gets a nearest-source lookup: `doc-brs20-s1` (backup retention) returned `use` at 99% relevance. It renders under "No evidence quote was returned. Nearest sources by relevance (Clocked Rerank)", explicitly labeled as not Verify evidence; the dashed no-evidence note stays.

### What changed between runs (display layer only)

1. Compare finding quotes — verbatim extractions that can be as short as a section heading — are now displayed with the surrounding source section, located by character offsets in the passage registry.
2. A claim Verify contradicts is cross-linked to the opposing passage of the flagged Compare pair. The join uses only live outputs (the claim's evidence document and the pair's own findings), is attributed to Compare, and links to the pair card.
3. Nearest-source Rerank lookups now also run for counted claims that return no evidence quote (previously only `not_stated` claims), capped at four per run and executed in waves of at most three to respect the four-concurrent-request limit.

No endpoint result was altered, cached, or fabricated; every verdict, score, quote, and relation above is exactly what the endpoints returned.

---

## Run 3 — 2026-11-07, ~3:25 PM IST (09:55 UTC)

Run immediately after the second round of evidence-display fixes (listed at the bottom). All four cases through `POST /api/analyze` with a live `CLOCKED_API_KEY`; model on every call `clocked-1.0`. All four triage states identical to Runs 1 and 2 — no regression from the display changes, which is expected: they touch only how endpoint outputs are shown, never what the endpoints returned.

### Case 2 — True conflict (`conflict`)

Claim #1 (12 months) `contradicted` (evidence quote from doc-sp21) · Compare pair `doc-sp21 ↔ doc-rs26` `conflicting`, one finding kind `value` · triage `conflict_needs_decision`.

**Fix observed (opposing side, chosen by wording):** the claim card now leads with the opposing passage — "Audit log records are retained for 24 months from the date of record, then deleted." — from Retention Schedule 2026 (doc-rs26), attributed to the Compare cross-check, followed by the note "The claim's wording is closest to Security Policy v2.1 (doc-sp21)". The Verify evidence extraction (the 12-month quote) renders below it, labeled as what it is. The side selection compares the claim text to each side's passages (heading-only extractions resolved to their full sections first), so it cannot flip when Verify happens to cite the contradicting document as evidence; if the two sides cannot be told apart, both are shown side by side.

**Fix observed (heading-only quote):** the pair finding's a-side extraction was again the bare heading `## Audit log retention` (chars 186–208). The cross-check card now displays the full 12-month section in its place, with the note "Endpoint extraction was the section heading only: '## Audit log retention'" — the raw extraction and its offsets stay visible. The b-side's leading `## Audit records` heading line is stripped from display; the sentence text is shown verbatim.

### Case 4 — Different-scope numbers (`scope-trap`)

Claim #2 (7-year backup archives) `supported` **without** an evidence quote, as in Runs 1–2 · Compare `unrelated` (0 conflicts) · triage `ready_for_review`.

**Fix observed (claim-level quote for an unevidenced supported claim):** the claim-level Rerank lookup returned `doc-brs20-s1` (Backup retention) `use` at 99% relevance; the claim card now shows it as a quote block — "Full backup archives are retained for 7 years. …" — under "Closest source passage (Clocked Rerank — Verify returned no evidence quote for this claim)", with the enrichment-only disclaimer ("not Verify evidence; the verdict and the review state are exactly what the endpoints returned") and the remaining nearest sources listed below. The markdown export mirrors the same passage with the same attribution.

### Cases 1 and 3

Case 1 (`supported`): grounded 0.99+, both claims supported with evidence, `overlapping`, `ready_for_review` — unchanged. Case 3 (`missing`): both claims `not_stated`, all passages skipped, `missing_evidence` — unchanged. Trace latencies across all cases 327–626 ms per call; no errors, no retries.

### What changed between runs (display layer only, round 2)

1. **Quote resolution** (`src/lib/registry.ts`): endpoint extractions are resolved for display — a leading heading line is stripped, and a heading-only extraction is replaced by its full source section located by the endpoint's own character offsets. The raw extraction and offsets remain visible in a note; nothing outside the supplied documents is used.
2. **Opposing-side selection by wording** (`src/lib/analysis.ts`): which side of a flagged Compare pair is "the opposing passage" for a contradicted claim is decided by token overlap between the claim text and each side's (resolved) passages — not by which document Verify cited as evidence. Indeterminate cases show both sides. All quotes shown are live endpoint outputs; only the labels are derived.
3. **Contradicted claims lead with the opposition** (`src/components/proofbrief/VerifyCard.tsx`): the rose opposing-passage block renders above the teal Verify evidence extraction, so the citation a reviewer sees first on a conflicted claim is the passage that disagrees with it.
4. **Claim-level quote for supported-but-unevidenced claims** (VerifyCard + ExportBar): the top `use` passage of the claim-level Rerank lookup renders as a quote block attached to the claim, clearly labeled as a relevance match rather than Verify evidence.

Verified by `bun scripts/check-display-fixes.ts` (20 offline checks against the saved Run-2 endpoint outputs, including the flipped-evidence variance) and by the live Run 3 above. No endpoint result was altered, cached, or fabricated.

---

## Run 4 — 2026-11-07, 4:46 PM IST (11:16 UTC)

Single-case live rerun of the conflict case after the Markdown export fix, prompted by an external read-only check of the deployed app: the UI and the claim ledger resolved a heading-only Compare extraction to its full section, but the packet's "Source cross-check" section still printed the bare heading. Three live calls (Rerank, Verify, Compare; no claim-level lookups were needed — both claims returned evidence quotes this run); model `clocked-1.0` on every call. Outputs saved to `tool-results/run4-conflict.json`.

### Case 2 — True conflict (`conflict`) — endpoint behavior unchanged

Claim #1 (12 months) `contradicted` (supported 4% · contradicted 95% · not_stated 1%, evidence quote from doc-sp21) · Claim #2 (deletion) `supported` (94%) · Compare pair `doc-sp21 ↔ doc-rs26` `conflicting` (related 98%), one finding kind `value` · grounded 0.61 · answers_question 0.99 · triage `conflict_needs_decision`. The Compare a-side extraction was again the bare heading `## Audit log retention` (chars 186–208) — the endpoint reliably returns it, which is exactly what made the export gap visible.

**Fix observed (export parity):** the exported packet's Source cross-check section now shows, on the doc-sp21 side, the full 12-month section — "Northwind retains customer audit logs for 12 months from the date of record. At the end of the retention period, audit logs are automatically and permanently deleted from all production and backup systems." — with the note `endpoint extraction was the section heading only ("## Audit log retention"); the full section is shown`, and on the doc-rs26 side the 24-month sentence with its leading heading line stripped. The claim ledger's opposing passage (doc-rs26, 24 months) and the wording-attribution note are unchanged.

### What changed (export layer only)

The Markdown builder moved from the client component (`ExportBar.tsx`) into a pure module `src/lib/export.ts`, and its Source cross-check section now resolves every conflict quote with the same `resolveQuote` used by the UI's compare card and the claim ledger: a heading-only extraction is exported as its full source section located by the endpoint's own offsets, and the raw extraction stays in the note. The JSON export is unchanged — it still dumps the raw endpoint record. Verified by `bun scripts/check-export-fix.ts` (15 offline checks against this run's saved outputs), by the live run above, and by a clean production build and typecheck. No endpoint result was altered, cached, or fabricated.

---

## Run 5 — 2026-11-07, 5:44–5:45 PM IST (12:14 UTC)

Full five-case live run after the hardening changes (relevance gate, runtime validation, retry/backoff, concurrency guard), all through `POST /api/analyze`; model `clocked-1.0` on every call, no retries needed, no 429s. Outputs saved to `tool-results/run5-*.json`.

### All five states, including the new relevance gate

| Case | grounded | answers_question | claim verdicts | compare | triage |
| --- | --- | --- | --- | --- | --- |
| supported | 1.00 | 0.995 | supported ×2 | overlapping | ready_for_review |
| conflict | 0.61 | 0.995 | contradicted, supported | conflicting (pair 0) | conflict_needs_decision |
| missing | 0.00 | 0.988 | not_stated ×2 | overlapping | missing_evidence |
| scope-trap | 1.00 | 0.995 | supported ×2 | unrelated | ready_for_review |
| wrong-question | 1.00 | **0.006** | supported ×2 | overlapping | **review_required** |

### New case 5 — Accurate but off-topic (`wrong-question`)

The exact edge the hardening addresses: every claim is grounded (grounded 1.00, both claims `supported`), the documents agree (overlapping, no conflict), and yet Verify scored the draft's relevance to the customer's question at **0.006** — the draft talks about access permissions and transport encryption while the customer asked about audit-log retention. Before this change the triage would have said "ready for human review"; now it returns `review_required` with the reason: "Verify's answers_question score is 0.01 (below 0.5): the draft's claims may be grounded in the sources, but the draft may not answer the customer's actual question. A human must decide whether the reply should be rewritten." Grounding and relevance are separate signals, and the state machine now uses both.

### Concurrency guard

Two simultaneous `/api/analyze` requests (supported + conflict): the first ran to completion (`ready_for_review`), the second was rejected immediately with HTTP 429 `busy` — "Another evidence check is still running — this demo runs one analysis at a time to stay inside Clocked's concurrency limits… This is not a source conflict." One analysis fires the three core calls in parallel; two overlapping analyses would trip the platform's build-tier limit of 4 concurrent requests (observed once as a Rerank 429 during concurrent rechecks earlier on 2026-11-07).

### What changed (hardening round)

1. **Relevance gate** (`src/lib/analysis.ts`): Verify's `answers_question` (0–1, returned when a question is supplied) now gates the triage below 0.5 — the platform's own default threshold convention. A missing score fails closed the same way. A source conflict still takes the headline state; the gate cannot mask one.
2. **Runtime validation, fail closed** (`src/lib/validate.ts`, zod): every endpoint response is checked against the documented shape — verdict/action/relation enum allowlists, 0–1 scores, integer offsets, end ≥ start. Anything unexpected makes that endpoint not-ok with code `invalid_response`, and the review state can never be "ready" from an ununderstood output. A Rerank `use` result that joins to no registry passage (unknown id, out-of-range index) no longer counts as a source basis.
3. **analysis_incomplete state**: retryable failures (429, 5xx, network) return a distinct "Analysis incomplete — retry later" state, explicitly labeled "not a source conflict and not a verdict"; non-retryable 4xx and validation failures stay `review_required`.
4. **Bounded 429 backoff** (`src/lib/clocked.ts`): up to 3 attempts per logical request, exponential backoff with ±20% jitter (800 ms / 2 s base, 8 s cap), honoring a server `Retry-After` hint, idempotency key reused verbatim — matching the platform's limits guidance (wait and retry, never add parallelism).
5. **Concurrency guard** (`src/app/api/analyze/route.ts`): one analysis at a time per instance plus a 4 s per-IP cooldown; over the cap the route answers 429 `busy` so the client retries. Module state is per-instance on serverless (documented limitation; a durable cap needs shared storage).
6. **Export/UI offsets honesty**: an expanded heading-only extraction now keeps its character offsets beside the raw-extraction note only — never next to the full section text — in the Markdown export and both cards, so the offsets cannot be misread as spanning the whole section.
7. **Enrichment labeling**: a supported claim without a Verify evidence quote leads with "No direct Verify evidence was returned for this claim" before the Rerank closest-passage match, labeled "enrichment, not proof" (UI and export).

Verified by `bun scripts/check-hardening.ts` (35 offline checks: gate, fail-closed validation, incomplete-state mapping, orphan passages, export offsets), the existing two offline suites (still green), a clean `bunx tsc --noEmit`, clean `eslint .`, and a production build with the TypeScript bypass removed. No endpoint result was altered, cached, or fabricated.

---

## Run metadata template

```
date/time (IST):
case id:
rerank model / verify model / compare model:
grounded score:
compare roll-up verdict:
triage state:
notes:
```
