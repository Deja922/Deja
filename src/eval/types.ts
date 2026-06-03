export type TaskType =
  | "coding"
  | "planning"
  | "reasoning"
  | "summarization"
  | "agent_workflow";

export interface EvalTask {
  id: string;
  type: TaskType;
  name: string;
  prompt: string;
  systemPrompt?: string;
  // Simulated prior conversation history (to give the compressor something to work on)
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  // Keywords the answer should cover — used by heuristic scorer
  expectedKeywords: string[];
  // Structural features expected in a good answer
  expectedStructure: {
    codeBlocks?: boolean;
    headers?: boolean;
    bullets?: boolean;
    numberedList?: boolean;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ScoredOutput {
  response: string;
  usage: TokenUsage;
  qualityScore: number;        // 0–10
  scoreBreakdown: ScoreBreakdown;
  latencyMs: number;
}

export interface ScoreBreakdown {
  structure: number;           // 0–10
  keywordCoverage: number;     // 0–10
  length: number;              // 0–10
  format: number;              // 0–10  (task-type specific)
  judgeScore?: number;         // 0–10, only when --judge flag used
}

export interface EvalResult {
  taskId: string;
  taskType: TaskType;
  taskName: string;
  baseline: ScoredOutput;   // undefined when mode === "optimized"
  optimized: ScoredOutput;  // undefined when mode === "baseline"
  tokenSavingsPct: number;
  qualityDelta: number;
  pipelineStats?: {
    originalTokens: number;
    outputTokens: number;
    compressionRatio: number;
    messagesDropped: number;
    messagesSummarized: number;
  };
}

export interface EvalReport {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  judgeEnabled: boolean;
  mode: EvalMode;
  results: EvalResult[];
  summary: EvalSummary;
}

export interface EvalSummary {
  totalTasks: number;
  avgTokenSavingsPct: number;
  avgQualityDelta: number;
  avgBaselineQuality: number;
  avgOptimizedQuality: number;
  avgBaselineTokens: number;
  avgOptimizedTokens: number;
  verdict: string;             // human-readable overall verdict
}

export type EvalMode = "baseline" | "optimized" | "both";

export interface EvalOptions {
  taskFilter?: TaskType[];
  provider: "claude" | "openai" | "mock";
  model: string;
  maxTokens: number;
  targetTokens: number;
  judgeEnabled: boolean;
  outputFile?: string;
  verbose: boolean;
  mode: EvalMode;
}
