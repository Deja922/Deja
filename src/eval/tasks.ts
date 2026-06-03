import type { EvalTask } from "./types.js";

// Each task simulates a realistic multi-turn session so the compressor has
// actual history to work on, not just a single-shot prompt.

export const EVAL_TASKS: EvalTask[] = [
  // ────────────────────────────────────────────────────────────────────────
  // 1. CODING
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "coding-react-hooks",
    type: "coding",
    name: "Coding — React custom hook",
    systemPrompt:
      "You are a senior TypeScript engineer. Write clean, type-safe code. Always include error handling.",
    history: [
      {
        role: "user",
        content:
          "I'm building a dashboard that needs to fetch data from multiple endpoints simultaneously. The main endpoints are /api/users, /api/metrics, and /api/alerts. I need all three to load in parallel.",
      },
      {
        role: "assistant",
        content:
          "Great plan — parallel fetching avoids waterfall latency. You can use Promise.all inside a useEffect or, better, a custom hook. Here's a sketch:\n\n```ts\nfunction useDashboard() {\n  const [data, setData] = useState(null);\n  useEffect(() => {\n    Promise.all([\n      fetch('/api/users').then(r => r.json()),\n      fetch('/api/metrics').then(r => r.json()),\n      fetch('/api/alerts').then(r => r.json()),\n    ]).then(([users, metrics, alerts]) => setData({ users, metrics, alerts }));\n  }, []);\n  return data;\n}\n```\n\nThis is the basic shape — we'll want to add loading/error states and abort on unmount.",
      },
      {
        role: "user",
        content:
          "Good. Now I also need to handle the case where only some requests fail — partial data should still display. And I want loading/error state per endpoint, not a single shared one.",
      },
      {
        role: "assistant",
        content:
          "Understood — per-endpoint state requires tracking each slice independently. You'd structure the state as a record keyed by endpoint name, each holding { data, loading, error }. Using Promise.allSettled instead of Promise.all lets partial failures through.",
      },
    ],
    prompt:
      "Now implement the complete custom hook `useDashboard` with: per-endpoint loading/error state, abort on unmount via AbortController, TypeScript generics so it can be reused for other endpoint sets, and a retry mechanism with exponential backoff (max 3 retries).",
    expectedKeywords: [
      "AbortController",
      "useEffect",
      "useState",
      "Promise.allSettled",
      "retry",
      "exponential",
      "generic",
      "TypeScript",
    ],
    expectedStructure: { codeBlocks: true, headers: false, bullets: true },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 2. PLANNING
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "planning-saas-launch",
    type: "planning",
    name: "Planning — SaaS product launch",
    systemPrompt:
      "You are a product manager. Produce structured, actionable plans with clear owners, timelines, and success metrics.",
    history: [
      {
        role: "user",
        content:
          "We're launching an AI-powered code review SaaS in 3 months. Team: 2 engineers, 1 designer, 1 PM (me). Budget: $50k for the quarter. Target market: indie developers and small teams (2-10 people).",
      },
      {
        role: "assistant",
        content:
          "Got it — constrained team, tight timeline, well-defined ICP. Key risks: (1) scope creep, (2) integration complexity with GitHub/GitLab, (3) cold-start with no existing users. I'd suggest a phased approach: MVP in week 6, closed beta weeks 7-9, public launch week 12. Want me to break down each phase?",
      },
      {
        role: "user",
        content:
          "Yes, but first: we've decided the MVP must include GitHub integration, PR-level comments, and a basic dashboard showing review stats. Stripe billing is deferred to month 2.",
      },
      {
        role: "assistant",
        content:
          "Noted. That scopes MVP to: GitHub OAuth + webhook listener, PR comment bot, stats dashboard (read-only). Stripe deferred is the right call — validate the value prop before monetizing. That leaves about 5 sprints for MVP. Biggest unknown is the GitHub webhook + bot approval process — can take 1-2 weeks if you need Marketplace listing.",
      },
    ],
    prompt:
      "Create a detailed 12-week launch plan. For each week or phase, specify: key deliverables, who owns them, dependencies, risks, and how you'd measure success. Also include a go-to-market strategy for reaching the first 100 paying customers.",
    expectedKeywords: [
      "week",
      "milestone",
      "deliverable",
      "risk",
      "metric",
      "owner",
      "launch",
      "beta",
      "marketing",
      "customer",
    ],
    expectedStructure: { headers: true, bullets: true, numberedList: true },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 3. REASONING
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "reasoning-system-diagnosis",
    type: "reasoning",
    name: "Reasoning — System failure diagnosis",
    systemPrompt:
      "You are a site reliability engineer. Think step by step. Show your reasoning before conclusions.",
    history: [
      {
        role: "user",
        content:
          "Our API latency spiked from p99=120ms to p99=4200ms starting at 14:32 UTC. No deployment happened. Database CPU is at 12% (normal). Memory looks fine. Error rate unchanged at 0.2%.",
      },
      {
        role: "assistant",
        content:
          "Interesting — high latency without high error rate or DB load suggests the bottleneck is upstream of DB execution: either a slow query that's waiting (lock contention, slow index scan) or an external service call that's stalling. Since no deployment happened, look for: (1) a schema migration that might have run, (2) increased traffic pattern, (3) a third-party API dependency. What's your connection pool utilization?",
      },
      {
        role: "user",
        content:
          "Connection pool: 95% utilized (was 40%). Also found: slow query log shows one query went from 8ms avg to 380ms avg starting at 14:31. The query is: SELECT * FROM events WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC.",
      },
      {
        role: "assistant",
        content:
          "Classic index problem. The query needs a composite index on (user_id, created_at). If only user_id is indexed, it's doing a full index scan + sort. At 14:31 something changed the data distribution — possibly the events table crossed a size threshold where the query planner stopped using the index efficiently, or an index was accidentally dropped. Check: EXPLAIN ANALYZE on that query, then pg_stat_user_indexes for the events table.",
      },
    ],
    prompt:
      "EXPLAIN output shows: Seq Scan on events (cost=0.00..89234.12 rows=2341234 width=487) Filter: ((user_id = 12345) AND (created_at > '2026-01-01')). pg_stat_user_indexes shows the index `idx_events_user_id` exists but has 0 index scans since 14:28. Diagnose exactly what happened, explain the root cause chain, and provide the immediate fix plus a permanent solution to prevent recurrence.",
    expectedKeywords: [
      "sequential scan",
      "index",
      "planner",
      "statistics",
      "ANALYZE",
      "autovacuum",
      "bloat",
      "CREATE INDEX",
      "CONCURRENTLY",
    ],
    expectedStructure: { headers: true, bullets: true, numberedList: true },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 4. SUMMARIZATION
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "summarization-research-paper",
    type: "summarization",
    name: "Summarization — Technical research distillation",
    systemPrompt:
      "You are a technical writer. Produce concise, accurate summaries that preserve key insights while eliminating redundancy.",
    history: [
      {
        role: "user",
        content: `I need to summarize this research for our engineering team. The paper is about "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (Lewis et al., 2020). Key sections:

ABSTRACT: RAG combines pre-trained parametric memory (LLM) with non-parametric memory (retrieval from a dense vector index). The retriever finds relevant documents, which are then fed to a seq2seq model as context. RAG achieves new SOTA on open-domain QA tasks.

INTRODUCTION: Large LMs store knowledge in parameters, but this is brittle — factual errors, inability to update without retraining, no source attribution. RAG addresses this by decoupling knowledge storage from the model.

METHOD: Two variants: RAG-Sequence (same retrieved docs across full generation) and RAG-Token (can retrieve different docs per token). Retriever: DPR (Dense Passage Retrieval) with FAISS index over Wikipedia. Generator: BART-large.

RESULTS: On Natural Questions: RAG 44.5 EM vs T5 (11B) 42.9 EM, with RAG using only 400M params. On TriviaQA: RAG 56.8 vs T5 60.5 but RAG doesn't use fine-tuned retriever. On MS-MARCO: RAG 217.2 ROUGE-L (human 220.6).

LIMITATIONS: Retrieval quality bottleneck, inference latency (retrieval adds ~50ms), index freshness (static Wikipedia snapshot), no multi-hop reasoning.`,
      },
      {
        role: "assistant",
        content:
          "Understood — I'll distill this for an engineering audience. The core insight is the parametric vs non-parametric memory split: LLMs encode world knowledge in weights (expensive to update), while RAG externalizes it to a searchable index (cheap to update, auditable). This is the key architectural shift that makes RAG practically useful.",
      },
    ],
    prompt:
      "Write the final summary for our team wiki. It should: (1) explain the core problem RAG solves in one paragraph, (2) describe the architecture in a way an engineer can implement, (3) give the key benchmark results with honest context, (4) list the 3 most important limitations for production use, and (5) end with a 'when to use RAG vs fine-tuning' decision guide.",
    expectedKeywords: [
      "retrieval",
      "parametric",
      "dense",
      "FAISS",
      "BART",
      "DPR",
      "latency",
      "index",
      "fine-tuning",
      "benchmark",
    ],
    expectedStructure: { headers: true, bullets: true, numberedList: true },
  },

  // ────────────────────────────────────────────────────────────────────────
  // 5. AGENT WORKFLOW
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "agent-workflow-data-pipeline",
    type: "agent_workflow",
    name: "Agent Workflow — Data pipeline design",
    systemPrompt:
      "You are an autonomous data engineering agent. Break complex tasks into steps, execute each step, and report results. Be specific about tool calls and data transformations.",
    history: [
      {
        role: "user",
        content:
          "Goal: Build a daily pipeline that (1) ingests raw event logs from S3, (2) cleans and deduplicates, (3) computes daily active users (DAU) and feature usage metrics, (4) writes results to BigQuery, (5) triggers a Slack alert if DAU drops >20% from 7-day avg.",
      },
      {
        role: "assistant",
        content:
          "Breaking this into 5 stages. Stage 1 (Ingestion): S3 → GCS or direct read via boto3/s3fs. Stage 2 (Clean): pandas or Spark depending on volume — what's the daily log size? Stage 3 (Compute): DAU = distinct(user_id) per day; feature usage = COUNT(*) GROUP BY feature_id. Stage 4 (BQ write): bigquery.Client().load_table_from_dataframe(). Stage 5 (Alert): compare today DAU vs rolling 7-day avg, POST to Slack webhook if delta < -20%.",
      },
      {
        role: "user",
        content:
          "Daily volume: ~50GB compressed Parquet. Events schema: {event_id: UUID, user_id: string, feature_id: string, timestamp: ISO8601, session_id: string, properties: JSON}. We already have a GCP project. Prefer Dataflow over Spark for managed infra.",
      },
      {
        role: "assistant",
        content:
          "Good — 50GB is solidly in Dataflow territory. Apache Beam on Dataflow handles this cleanly with autoscaling. Key pipeline design: read from S3 via beam.io.ReadFromParquet → deduplicate on event_id within a 25-hour window (handles late arrivals) → compute metrics with beam.CombinePerKey → write to BQ via beam.io.WriteToBigQuery. The 25-hour dedup window catches the common case of events arriving up to 1h late.",
      },
    ],
    prompt:
      "Now produce the complete implementation plan including: (1) the full Apache Beam pipeline code structure (Python), (2) BigQuery schema for the output metrics table, (3) the Slack alert Lambda/Cloud Function with the DAU comparison logic, (4) Cloud Scheduler setup for daily 02:00 UTC trigger, and (5) monitoring — what metrics and alerts to set up to know the pipeline is healthy.",
    expectedKeywords: [
      "Beam",
      "Dataflow",
      "BigQuery",
      "schema",
      "Slack",
      "Cloud Scheduler",
      "deduplication",
      "window",
      "monitoring",
      "alert",
    ],
    expectedStructure: { codeBlocks: true, headers: true, bullets: true, numberedList: true },
  },
];

export function getTasksByType(types: string[]): EvalTask[] {
  if (types.length === 0) return EVAL_TASKS;
  return EVAL_TASKS.filter((t) => types.includes(t.type));
}
