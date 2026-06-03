# Deja

**Stop paying for the same context twice.**

Context Engine is a TypeScript middleware that sits between your code and any LLM API. It compresses, deduplicates, and summarizes conversation history before each request — so your long coding sessions stay sharp instead of bloated.

Tested on 20-round coding sessions with Claude Sonnet: **71.6% fewer prompt tokens, +0.8 quality improvement, 10/10 memory retention.**

<!-- demo gif goes here — record with: npm run demo -->

---

## The Problem

You open Claude Code (or Cursor, or Codex) and start a session. Hour two, something shifts. The model starts forgetting decisions from earlier. It contradicts itself. Responses get slower and more expensive.

This isn't a model limitation — it's a context problem. By round 20, your session is sending 21,000+ tokens of conversation history on every single request. Most of it is redundant.

```
Round  1:    108 tokens sent
Round  5:  4,568 tokens sent
Round 10: 10,153 tokens sent
Round 20: 21,220 tokens sent   ← you're paying for the entire session every time
```

Context Engine fixes this.

```
Round  1:    108 tokens sent   (same)
Round  5:  1,239 tokens sent   (-73%)
Round 10:  2,342 tokens sent   (-77%)
Round 20:  5,578 tokens sent   (-74%)   ← stable, not growing
```

---

## Benchmark

20-round TypeScript coding session (architecture → refactor → bug fixes → deployment). Real Claude Sonnet API calls, no mocking.

| Metric | Baseline | Context Engine | Δ |
|---|---|---|---|
| Total prompt tokens | 213,721 | 60,628 | **-71.6%** |
| Final round tokens | 21,220 | 5,578 | **-73.7%** |
| Avg response quality | 7.4 / 10 | 8.2 / 10 | **+0.8** |
| Memory retention | 10 / 10 | 10 / 10 | 0 |
| Reasoning stability | 8.7 / 10 | 8.4 / 10 | -0.3 |

Quality goes *up* because compression removes noise and keeps the signal. The model gets a cleaner, more focused context.

Memory retention stays perfect — decisions made in round 1 are still referenced correctly in round 20.

---

## Why This Is Different

Most "prompt compression" tools just truncate old messages or summarize everything into a blob. That breaks reasoning chains and loses critical decisions.

Context Engine runs a **5-stage pipeline** on every request:

1. **Cleanup** — remove exact and near-duplicate messages (Jaccard similarity > 0.85)
2. **Ranking** — score each message: recency (40%) + content density (30%) + role (20%) + uniqueness (10%)
3. **Compression** — drop low-score messages, summarize medium-score ones with extractive summarization (no LLM needed)
4. **Memory inject** — retrieve relevant past context from a persistent vector store and prepend it
5. **Token budget** — hard ceiling enforcement, always preserving the last user message

The result: your context window contains the *right* history, not just the *recent* history.

---

## Features

- **Provider-agnostic** — Claude, OpenAI, or bring your own via `IProvider`
- **No external dependencies for compression** — scoring and summarization run locally, no extra API calls
- **Persistent memory** — 256-dim hash embeddings stored to `~/.context-engine/memory.json`, survives restarts
- **Eval harness built-in** — run `npm run eval` or `npm run eval:long` to benchmark against your own workloads
- **TypeScript-first** — strict types throughout, ESM, Node 20+

---

## Run the Demo

The repo ships with a 60-second terminal demo that replays the real benchmark data — no API calls required.

```bash
npm run demo
```

To record it as a GIF for GitHub / Twitter:

```bash
# Install tools (one-time)
npm install -g @asciinema/cli agg

# Record (~60 seconds)
asciinema rec demo.cast --command "npx tsx src/cli/demo.ts"

# Convert to GIF
agg demo.cast demo.gif --theme monokai --font-size 14
```

---

## Install

```bash
git clone https://github.com/your-org/context-engine
cd context-engine
npm install
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-...
# or
export OPENAI_API_KEY=sk-...
```

---

## CLI Usage

**Single prompt, compare baseline vs optimized:**

```bash
npx tsx src/cli/ai-context.ts run "Refactor this auth module to use JWT" \
  --context examples/life-sim-system.json \
  --mode both
```

Output:
```
┌─────────────┬───────────┬───────────┬──────────┬─────────┬──────────┐
│ Mode        │ Prompt T  │ Compl T   │ Savings  │ Quality │ Latency  │
├─────────────┼───────────┼───────────┼──────────┼─────────┼──────────┤
│ baseline    │     1,188 │       412 │        — │     7.2 │  4,210ms │
│ optimized   │       776 │       398 │  +34.7%  │     7.8 │  3,890ms │
└─────────────┴───────────┴───────────┴──────────┴─────────┴──────────┘
```

**Run the eval harness (5 task types):**

```bash
npm run eval -- --provider claude --mode both
```

**Run the long-session benchmark (20 rounds):**

```bash
npm run eval:long -- --provider claude --rounds 20
```

**Run one mode at a time:**

```bash
npm run eval:long -- --mode baseline --rounds 20
# check your API dashboard, then:
npm run eval:long -- --mode optimized --rounds 20
```

---

## Use as a Library

```typescript
import { Pipeline, loadConfig } from './src/core/index.js'
import { ClaudeProvider } from './src/providers/claude.js'

const pipeline = new Pipeline()
const config = await loadConfig({ maxTokens: 8000, targetTokens: 3000 })

// Your existing conversation context
const context = {
  messages: conversationHistory,
  systemPrompt: 'You are a senior TypeScript engineer...'
}

// Compress before sending to the API
const { context: compressed, stats } = await pipeline.run(context, config)

console.log(`${stats.originalTokens} → ${stats.outputTokens} tokens`)
console.log(`Dropped ${stats.messagesDropped}, summarized ${stats.messagesSummarized}`)

const provider = new ClaudeProvider()
const response = await provider.send({ context: compressed, maxTokens: 1024 })
```

---

## Architecture

```
Your app
   │
   ▼
┌──────────────────────────────────────────────┐
│  Pipeline                                    │
│                                              │
│  1. Cleanup      dedup + remove noise        │
│  2. Ranking      score each message 0–1      │
│  3. Compression  drop + extractive summary   │
│  4. Memory       inject relevant past turns  │
│  5. Budget       hard token ceiling          │
└──────────────────────────────────────────────┘
   │
   ▼
LLM API  (Claude / OpenAI / local)
```

The pipeline is pure TypeScript with no native dependencies. Compression uses extractive summarization — no extra LLM calls. Memory uses hash-based 256-dim embeddings stored locally as JSON.

---

## Configuration

```typescript
// config/default.json
{
  "maxTokens": 8000,        // hard ceiling — never exceed this
  "targetTokens": 3000,     // soft target after compression
  "compressionRatio": 0.6,  // how aggressively to compress
  "rankingThreshold": 0.3,  // drop messages below this score
  "memoryEnabled": true,
  "memoryTopK": 3           // inject top 3 relevant memories
}
```

Lower `targetTokens` = more aggressive compression = more savings. The sweet spot for coding sessions is `3000–4000`.

---

## Eval Harness

Context Engine ships with a built-in evaluation system so you can measure impact on your own workloads.

**5-task eval** (coding, planning, reasoning, summarization, agent workflow):

```bash
npm run eval -- --provider claude
npm run eval -- --provider claude --judge   # Claude Haiku scores quality
npm run eval -- --task coding reasoning     # run a subset
```

**20-round long-session eval:**

```bash
npm run eval:long -- --provider claude --rounds 20
npm run eval:long -- --provider claude --rounds 20 --judge
```

Results auto-save to `~/.context-engine/eval-logs/` and `~/.context-engine/long-eval-logs/`.

---

## Roadmap

- [ ] Streaming support — compress before first token, stream the rest
- [ ] OpenAI text-embedding-3-small — upgrade from hash embeddings for better memory retrieval
- [ ] Session replay — load a `.jsonl` conversation log and benchmark it
- [ ] VS Code extension — integrate directly into Claude Code / Cursor workflows
- [ ] SQLite memory backend — replace JSON file store for large memory sets
- [ ] Ranking v2 — TF-IDF across session instead of per-message density
- [ ] Cost tracking — report $ saved based on model pricing

---

## Tests

```bash
npm test           # 28 unit tests
npm run typecheck  # strict TypeScript check
```

---

## License

MIT
