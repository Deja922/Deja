# Deja Beta Gate — Public Release Criteria

Last updated: 2026-06-10

## Purpose

This document defines the minimum measurable thresholds that must pass before Deja
is declared ready for public beta. All metrics are measured over a **standard eval
run** (`npm run eval` or equivalent) using `src/eval/` fixtures unless noted.

---

## Metrics & Minimum Thresholds

| # | Metric | Definition | Minimum to Pass |
|---|--------|-----------|----------------|
| 1 | **Compression success rate** | Requests that complete without API 4xx/5xx attributable to Deja (excl. upstream auth errors) | ≥ 97% |
| 2 | **Off-topic / wrong-answer rate** | Turns where the LLM response is judged semantically unrelated to the prompt (manual spot-check or `scoreQuality < 0.4`) | ≤ 2% |
| 3 | **Repetition rate** | Turns where the LLM response repeats a substantial block (≥ 3 sentences) verbatim from a prior turn in the same session | ≤ 3% |
| 4 | **Auto-bypass trigger rate** | Sessions where `bypassReason="auto-high-compression"` fires at least once (compression ratio ≥ 75%) | ≤ 15% |
| 5 | **Token savings rate** | `1 - (outputTokens / originalTokens)` averaged over compressed requests only | ≥ 30% |
| 6 | **Compression latency overhead** | Median added wall-clock time per compressed request vs. passthrough baseline on same upstream | ≤ 800 ms |

---

## Evaluation Corpus

- **Short sessions** (< 2 000 tokens): 20 turns × 5 fixtures
- **Medium sessions** (2 000 – 8 000 tokens): 20 turns × 5 fixtures
- **Long sessions** (> 8 000 tokens): 20 turns × 3 fixtures (coding-heavy)
- All fixtures sourced from `src/eval/long-session/turns.ts` and `src/eval/tasks.ts`

---

## How to Measure

```
# Run eval suite (once implemented):
npm run eval -- --report beta-gate

# Manual spot-check proxy log for off-topic / repetition:
cat ~/.deja/proxy.log | node scripts/score-quality.mjs
```

Metrics 2 and 3 require manual or LLM-assisted review until an automated scorer
exists. Mark as PASS if a 50-turn random sample yields no violations above threshold.

---

## Hard Blockers (auto-fail regardless of metrics)

- Any session where Deja causes a **data loss** (messages silently dropped without bypass)
- Any API 400 "conversation must end with user message" error reaching the user
- `managed-settings.json` left behind after `deja service:remove`
- Health endpoint returning stale license tier after `deja license:activate`

---

## Sign-off Checklist

- [ ] Eval run completed, all 6 metrics at or above threshold
- [ ] Zero hard blockers in last 200-turn soak test
- [ ] `npm test` 100% pass on clean checkout
- [ ] `install.sh` end-to-end verified on macOS arm64 and Linux x64
- [ ] Dashboard shows correct tier/email/expiry immediately after activation
- [ ] Beta changelog drafted
