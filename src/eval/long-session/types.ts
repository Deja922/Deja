export type SessionMode = "baseline" | "optimized";

export type TurnTopic =
  | "architecture"
  | "refactor"
  | "bug_fixing"
  | "memory_system"
  | "provider_router"
  | "cli_optimization"
  | "testing"
  | "deployment"
  | "requirements"
  | "scope_definition"
  | "architecture_design"
  | "risk_assessment"
  | "implementation_plan"
  | "launch_planning"
  | "agent_setup"
  | "tool_execution"
  | "error_recovery"
  | "multi_step_workflow"
  | "production_monitoring";

export interface LongSessionTurn {
  id: number;               // 1–20
  topic: TurnTopic;
  userMessage: string;
  expectedKeywords: string[];
  // Memory checkpoint: references something decided in an earlier turn.
  // Used to measure memory retention.
  memoryCheckpoint?: {
    referencedTurnId: number;
    checkKeywords: string[];  // at least one must appear in the response
  };
}

export interface SessionRound {
  turnId: number;
  topic: TurnTopic;
  mode: SessionMode;
  promptTokens: number;      // tokens sent to the API this round
  completionTokens: number;
  historyTokens: number;     // total accumulated history size before this round
  compressedHistoryTokens?: number; // after pipeline (optimized only)
  response: string;
  qualityScore: number;      // 0–10 heuristic
  judgeScore?: number;       // 0–10 Claude Haiku judge (if enabled)
  latencyMs: number;
  protocolError?: string;    // "signature" | "thinking" | "rate_limit" | etc — null if no error
  pipelineStats?: {
    originalTokens: number;
    outputTokens: number;
    compressionRatio: number;
    messagesDropped: number;
  };
}

export interface LongSessionMetrics {
  avgRedundancyRate: number;   // 0–1, fraction of context that is near-duplicate
  memoryRetentionScore: number; // 0–10, how well early decisions are recalled
  reasoningDrift: number;       // 0–10, quality variance across rounds (lower = more stable)
  totalPromptTokens: number;
  totalCompletionTokens: number;
  tokenGrowthCurve: number[];   // promptTokens per round (length = numRounds)
  qualityCurve: number[];       // qualityScore per round
}

export interface LongSessionResult {
  mode: SessionMode;
  rounds: SessionRound[];
  metrics: LongSessionMetrics;
  protocolErrors: number;  // count of rounds that hit signature/thinking/protocol errors
}

export interface LongSessionReport {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  judgeEnabled: boolean;
  numRounds: number;
  baseline: LongSessionResult;
  optimized: LongSessionResult;
  summary: LongSessionSummary;
}

export interface LongSessionSummary {
  avgTokenSavingsPct: number;      // avg per-round savings
  peakTokenSavingsPct: number;     // highest single-round savings
  finalRoundSavingsPct: number;    // savings at the last round (most revealing)
  totalTokenSaved: number;         // cumulative prompt tokens saved
  qualityDelta: number;            // optimized avg quality - baseline avg quality
  memoryRetentionDelta: number;    // optimized - baseline memory retention
  verdict: string;
  taskBreakdown: TaskBreakdownEntry[];
}

export interface TaskBreakdownEntry {
  topic: TurnTopic;
  avgSavingsPct: number;
  avgQualityDelta: number;
  rounds: number;
}

export interface LongEvalOptions {
  provider: "claude" | "openai" | "mock";
  model: string;
  maxTokens: number;
  targetTokens: number;
  judgeEnabled: boolean;
  outputFile?: string;
  verbose: boolean;
  numRounds: number;
  mode: "baseline" | "optimized" | "both";
  workflow?: "coding" | "planning" | "agent";
}
