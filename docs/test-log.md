# ProofBrief — four-case test log

Expected outcomes below were written **before** running. Observed outcomes are recorded from real runs against the live Clocked endpoints and are **never hardcoded or edited to match expectations**. Model verdicts can vary between runs; that is a property of the platform, and this log exists to show the experiment honestly.

Run a case: start the app, select the case, press **Run evidence check**, then paste the observed summary below (or attach the exported JSON packet).

---

## Case 1 — Fully supported (`supported`)

| Endpoint | Expected |
|---|---|
| Rerank | Audit-retention passages rank as `use`; unrelated sections (backups, incident response) are skipped with reasons |
| Verify | Both claims supported by these documents, with evidence quotes and offsets |
| Compare | Documents relate (both cover audit-log retention); no conflicting pair |
| Triage | Ready for human review |

**Observed (run date, endpoint verdicts, deviations):**

- _to fill_

---

## Case 2 — True conflict (`conflict`)

| Endpoint | Expected |
|---|---|
| Rerank | Both audit-retention passages rank as `use`; the account-records section is skipped |
| Verify | The 12-month claim is contradicted by at least one source; evidence points to both passages |
| Compare | The audit-records pair is flagged conflicting with paired passages from both documents |
| Triage | Conflict — needs a human decision (approval blocked) |

**Observed (run date, endpoint verdicts, deviations):**

- _to fill_

---

## Case 3 — Missing evidence (`missing`)

| Endpoint | Expected |
|---|---|
| Rerank | Transit-encryption passages may rank as the closest available, or be skipped as not answering |
| Verify | Both claims `not_stated`: no source establishes them; the TLS 1.3 passage is about transport, not at-rest |
| Compare | Documents relate on retention; no conflicting pair |
| Triage | Missing evidence — needs input |

**Observed (run date, endpoint verdicts, deviations):**

- _to fill_

---

## Case 4 — Different-scope numbers (`scope-trap`)

| Endpoint | Expected |
|---|---|
| Rerank | Audit-retention and backup-retention passages rank as `use` for their respective parts of the question |
| Verify | Both claims supported by these documents |
| Compare | **Desired:** no conflicting pair, because the differing numbers describe different data types (audit logs vs backup archives). **Fallback:** if flagged, the pair routes to human resolution — which is the designed workflow either way |
| Triage | Ready for human review (desired) or conflict needs a decision (fallback) |

**Observed (run date, endpoint verdicts, deviations):**

- _to fill_

> Whichever way the endpoint behaves, record it here. The Compare documentation warns that "a document date or a differing number does not by itself establish a contradiction"; running this case is the experiment that shows we understand that.

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
