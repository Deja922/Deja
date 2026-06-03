# Benchmarks

All results from real Claude Sonnet API calls. No mocking.

## Long-Session Eval — 20 rounds

Simulates a real TypeScript coding session: architecture → refactor → bug fixing → memory system → provider router → CLI → testing → deployment.

### Per-round token usage

| Round | Topic | Baseline tokens | Deja tokens | Savings |
|---|---|---|---|---|
| 1 | architecture | 108 | 108 | 0% |
| 2 | architecture | 1,208 | 1,208 | 0% |
| 3 | refactor | 2,340 | 2,340 | 0% |
| 4 | bug fixing | 3,447 | 2,288 | -33.6% |
| 5 | memory system | 4,568 | 1,239 | -72.9% |
| 6 | provider router | 5,688 | 1,251 | -78.0% |
| 7 | refactor | 6,820 | 2,301 | -66.3% |
| 8 ★ | bug fixing | 7,929 | 2,290 | -71.1% |
| 9 | cli optimization | 9,037 | 2,358 | -73.9% |
| 10 | testing | 10,153 | 2,342 | -76.9% |
| 11 | deployment | 11,251 | 3,370 | -70.0% |
| 12 ★ | architecture | 12,345 | 3,357 | -72.8% |
| 13 | refactor | 13,474 | 3,446 | -74.4% |
| 14 | bug fixing | 14,591 | 3,448 | -76.4% |
| 15 | provider router | 15,692 | 4,490 | -71.4% |
| 16 ★ | testing | 16,805 | 4,510 | -73.2% |
| 17 | cli optimization | 17,913 | 4,577 | -74.4% |
| 18 | deployment | 19,008 | 4,544 | -76.1% |
| 19 | refactor | 20,124 | 5,583 | -72.3% |
| 20 ★ | deployment | 21,220 | 5,578 | -73.7% |

★ = memory checkpoint round (references decisions from earlier turns)

### Summary

| Metric | Baseline | Deja | Δ |
|---|---|---|---|
| Total prompt tokens | 213,721 | 60,628 | **-71.6%** |
| Total completion tokens | 20,477 | 20,480 | ≈0 |
| Final round tokens | 21,220 | 5,578 | **-73.7%** |
| Avg response quality (heuristic) | 7.4 / 10 | 8.2 / 10 | **+0.8** |
| Memory retention | 10 / 10 | 10 / 10 | 0 |
| Reasoning stability | 8.7 / 10 | 8.4 / 10 | -0.3 |

### Notes

- Compression kicks in at round 4 when history crosses the `targetTokens` threshold
- Memory retention tested via 4 checkpoint rounds (8, 12, 16, 20) that reference decisions from earlier turns — both modes scored 10/10
- Quality measured with heuristic scoring (structure + keyword coverage + length + format)
- Model: `claude-sonnet-4-6`, `max_tokens: 1024`, `targetTokens: 3000`

## 5-Task Eval

Short-context eval across 5 task types (coding, planning, reasoning, summarization, agent workflow).

| Task | Baseline tokens | Deja tokens | Savings | Base Q | Opt Q |
|---|---|---|---|---|---|
| Coding | 421 | 418 | -0.7% | 6.8 | 6.8 |
| Planning | 367 | 360 | -1.9% | 8.1 | 7.6 |
| Reasoning | 473 | 458 | -3.2% | 9.2 | 10.0 |
| Summarization | 566 | 537 | -5.1% | 9.7 | 8.8 |
| Agent Workflow | 550 | 494 | -10.2% | 7.5 | 7.9 |
| **Average** | **475** | **453** | **-4.6%** | **8.3** | **8.2** |

Note: short-context savings are modest because history stays under `targetTokens`. Deja's advantage compounds in longer sessions.

## Reproduce

```bash
# Long-session benchmark
npm run eval:long -- --provider claude --rounds 20 --mode baseline
npm run eval:long -- --provider claude --rounds 20 --mode optimized

# 5-task benchmark
npm run eval -- --provider claude --mode both
```

Results auto-save to `~/.deja/eval-logs/`.
