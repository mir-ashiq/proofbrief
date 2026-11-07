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
