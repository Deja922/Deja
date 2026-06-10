# Deja Dogfood Metrics

Last updated: 2026-06-10

## Purpose

Track daily real-world usage of Deja by the core team before public beta.
Thresholds mirror `docs/beta-gate.md`. A week with two or more FAIL days
blocks the beta release until root cause is fixed.

---

## Daily Log Template

Copy one block per day. Fill every field; write `n/a` only if Deja was not
used that day.

```
## YYYY-MM-DD

Session count      : ___          (number of Claude sessions routed through Deja)
Total requests     : ___
Compressed         : ___          (requests where compression fired)
Passthrough        : ___          (bypass or below-threshold)

### Metric 1 — Compression success rate
Failures (4xx/5xx caused by Deja) : ___
Rate = (compressed - failures) / compressed : ___%     PASS ≥97% / FAIL <97%

### Metric 2 — Off-topic / wrong-answer rate
Off-topic turns observed (manual) : ___
Rate = off-topic / total requests  : ___%     PASS ≤2%  / FAIL >2%

### Metric 3 — Repetition rate
Repetition turns observed (manual) : ___
Rate = repetition / total requests  : ___%     PASS ≤3%  / FAIL >3%

### Metric 4 — Auto-bypass trigger rate
Sessions that hit auto-bypass (≥75% ratio) : ___
Rate = auto-bypass sessions / session count  : ___%     PASS ≤15% / FAIL >15%

### Metric 5 — Token savings rate
Total original tokens  : ___
Total output tokens    : ___
Savings = 1 - (output / original) : ___%     PASS ≥30% / FAIL <30%

### Metric 6 — Compression latency overhead
Median added latency (ms) : ___              PASS ≤800ms / FAIL >800ms

### Hard blockers observed today
- [ ] Silent message drop
- [ ] API 400 reaching user
- [ ] managed-settings.json left after service:remove
- [ ] Stale license tier after activate
Any checked = automatic FAIL regardless of metric scores.

### Daily verdict
[ ] PASS — all metrics within threshold, no hard blockers
[ ] FAIL — reason: ________________________________

### Notes / anomalies
(free text)
```

---

## Weekly Summary Template

```
## Week of YYYY-MM-DD to YYYY-MM-DD

Days logged  : ___ / 7
Days PASS    : ___
Days FAIL    : ___
Days n/a     : ___

### Aggregated metrics (week total)
Compression success rate  : ___%
Off-topic rate            : ___%
Repetition rate           : ___%
Auto-bypass rate          : ___%
Token savings rate        : ___%
Median latency overhead   : ___ ms

### Trend vs prior week
Compression success : ▲/▼/─  ___pp
Off-topic           : ▲/▼/─  ___pp
Repetition          : ▲/▼/─  ___pp
Auto-bypass         : ▲/▼/─  ___pp
Token savings       : ▲/▼/─  ___pp
Latency overhead    : ▲/▼/─  ___ ms

### Weekly verdict
[ ] GREEN  — 0–1 FAIL days, all weekly aggregates within threshold
[ ] YELLOW — 2 FAIL days OR one metric outside threshold by <5pp
[ ] RED    — 3+ FAIL days OR any hard blocker OR metric outside threshold by ≥5pp

### Action items
1.
2.
```

---

## Pass / Fail Rules

### Daily

| Result | Condition |
|--------|-----------|
| PASS | All 6 metrics within threshold AND no hard blockers |
| FAIL | Any single metric outside threshold OR any hard blocker checked |

### Weekly

| Color | Condition |
|-------|-----------|
| GREEN | ≤ 1 FAIL day; all weekly aggregates within beta-gate thresholds |
| YELLOW | 2 FAIL days; or one metric outside threshold by < 5 percentage points |
| RED | ≥ 3 FAIL days; or any hard blocker; or any metric outside threshold by ≥ 5pp |

**Beta release is blocked while any week is RED.**
Two consecutive YELLOW weeks also block release until a fix is shipped and
verified over one GREEN week.

---

## Metric Reference (from beta-gate.md)

| Metric | Pass threshold |
|--------|---------------|
| Compression success rate | ≥ 97% |
| Off-topic / wrong-answer rate | ≤ 2% |
| Repetition rate | ≤ 3% |
| Auto-bypass trigger rate | ≤ 15% |
| Token savings rate | ≥ 30% |
| Latency overhead (median) | ≤ 800 ms |
