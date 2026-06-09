# Deja Context Engine — Progress & State

> Last updated: 2026-06-04

## What is this project?

**Deja Context Engine** (`deja-context` v0.1.0) — a local proxy and context compression pipeline that
sits between Claude Code and the upstream LLM API, compressing conversation history before each
request. Goal: stop AI coding sessions from hitting token limits and driving up API costs.

Architecture:
```
Claude Code → Deja Proxy (localhost:9090) → Upstream API (Anthropic / OpenAI / any compatible)
```
The proxy intercepts `/v1/messages` and `/v1/chat/completions` POST requests, runs the Pipeline
(tokenizer → compressor → summarizer), and forwards a smaller request body to the upstream API.
Internal Claude metadata (thinking blocks, signatures, redacted_thinking) is stripped.

Supports:
- Anthropic Messages API (Claude, DeepSeek via /anthropic, etc.)
- OpenAI Chat Completions API (GPT-4, DeepSeek, any OpenAI-compatible proxy/中转站)

## Current State

### Productization (2026-06-04)
- **`deja` unified CLI** — single entry point with subcommands: install, doctor, start, dashboard
- **`deja install`** — auto-detect Claude Code config, backup settings.json, inject ANTHROPIC_BASE_URL
- **`deja doctor`** — diagnostics: proxy, upstream, config, API key checks
- **`deja start`** — improved startup UX with dashboard URL
- **`deja dashboard`** — opens browser to local web UI with real-time stats
- **`GET /health`** — JSON health endpoint
- **`GET /__deja__`** — HTML dashboard page
- **QUICKSTART.md** — beginner-friendly docs in Chinese

### Proxy (running)
- **Status: ACTIVE** — Deja proxy is running on `http://localhost:9090`
- Upstream: `https://api.deepseek.com/anthropic`
- Started via: `npx tsx src/cli/proxy.ts --port 9090 --upstream https://api.deepseek.com/anthropic`
- Settings: `C:\Users\Administrator\.claude\settings.json` has `ANTHROPIC_BASE_URL: "http://localhost:9090"`
- Model chain: `ANTHROPIC_MODEL=deepseek-v4-pro`, haiku→`deepseek-v4-flash`, sonnet→`deepseek-v4-pro`
- Compression: target 4000 tokens, ceiling 8000, threshold 200 tokens
- **Verified working**: live traffic shows 14264→7164 tok (-50%) in 13ms

### Source structure
```
src/
  cli/
    deja.ts                — unified CLI (deja install/doctor/start/dashboard)
    commands/
      install.ts           — auto-detect + backup + inject config
      doctor.ts            — diagnostics
      start.ts             — improved startup
      dashboard.ts         — browser open
    index.ts               — legacy ctx CLI (compress/remember/memory-clear)
    proxy.ts               — legacy raw proxy CLI
    ...
  proxy/
    server.ts              — HTTP proxy + /health + /__deja__ endpoints
    dashboard.ts           — HTML dashboard renderer
    adapters/
      index.ts             — IAdapter interface
      anthropic.ts         — Anthropic Messages API adapter
      openai.ts            — OpenAI Chat Completions adapter
    detector.ts            — auto-detect adapter by URL path
    upstream.ts            — upstream forwarding
    config-types.ts        — RuntimeConfig, ProviderConfig, resolveEnv
    constants.ts           — block types, threshold
    ...
  compressor/              — Pipeline compressor, scorer, summarizer
  core/                    — Pipeline runner, config loader
  cache/                   — Token estimation
  memory/                  — Embeddings, similarity, vector DB, store
  eval/                    — Evaluation harness (short + long-session)
  types/                   — Core types (Context, Message, etc.)
tests/
  tokenizer.test.ts
  compressor.test.ts
  memory.test.ts
  proxy.test.ts            — 15 tests: quality, compression, structured content, HTTP forwarding
benchmarks/
  README.md                — results: long-session 20-round (71.6% savings), 5-task short (4.6% savings)
```

### Key files to know
- `src/proxy/server.ts` — HTTP proxy: request interception, health/dashboard endpoints, compression, forwarding
- `src/cli/deja.ts` — unified CLI entry point (deja install/doctor/start/dashboard)
- `src/core/pipeline.ts` — Pipeline orchestrator (5 stages)
- `src/compressor/index.ts` — message compression engine (4-pass)
- `src/proxy/adapters/anthropic.ts` — Anthropic API format handling
- `src/proxy/adapters/openai.ts` — OpenAI API format handling
- `tests/proxy.test.ts` — 15 comprehensive proxy tests

## Completed Tasks

1. **Codebase exploration** — mapped all source files, understood pipeline architecture
2. **Benchmark suite** — comprehensive benchmarks (tests/ and benchmarks/)
3. **Benchmark runs** — long-session eval, documented in benchmarks/README.md
   - 20-round long-session: **-71.6%** total tokens, quality score 8.2/10 (better than baseline 7.4)
   - 5-task short eval: -4.6% tokens, matching quality
4. **Fixed long-eval CLI** — added `--workflow coding|planning|agent` support
5. **Protocol error tracking** — stripping thinking/signature/redacted_thinking blocks
   - `cleanContentForResend()` rebuilds all blocks from scratch
6. **Context pollution fix** — MessageCategory classification, relevance filter
7. **Dead code cleanup** — removed ranking/ module, dead PipelineConfig fields
8. **Multi-provider architecture** — IAdapter pattern (Anthropic + OpenAI), format detection, upstream routing
9. **Productization** — unified `deja` CLI, install/doctor/start/dashboard, health/dashboard endpoints, QUICKSTART.md

## Pending

- **Regression benchmark orchestrator** (comprehensive, not yet started)
- **Proxy auto-restart** — needs manual restart if machine reboots

## User-facing CLI

```bash
npx tsx src/cli/deja.ts install           # auto-detect + configure
npx tsx src/cli/deja.ts start             # start proxy
npx tsx src/cli/deja.ts start --upstream <url>  # with custom upstream
npx tsx src/cli/deja.ts doctor            # run diagnostics
npx tsx src/cli/deja.ts dashboard         # open web UI
```

## How to restart the proxy

```powershell
$env:ANTHROPIC_API_KEY = "your-api-key"
npx tsx src/cli/deja.ts start --upstream https://api.deepseek.com/anthropic
```

## Test commands

```bash
npm test                          # run all tests (vitest) — 43 tests, 4 files
npm run test:watch                # watch mode
npm run typecheck                 # TypeScript check
```

## Eval commands

```bash
npm run eval -- --provider claude --mode both          # 5-task short eval
npm run eval:long -- --provider claude --rounds 20 --mode optimized --workflow coding
```
