import { randomUUID } from "crypto";
import type { Context, Message, PipelineConfig } from "@/types/index.js";
import { Pipeline, loadConfig } from "@/core/index.js";
import { estimateTokens } from "@/cache/tokenizer.js";
import { createProvider } from "@/proxy/provider-factory.js";
import { scoreHeuristic, scoreWithJudge } from "@/eval/scorer.js";
import type {
  LongSessionTurn,
  SessionRound,
  LongSessionResult,
  LongEvalOptions,
  SessionMode,
} from "./types.js";
import { computeMetrics } from "./metrics.js";

export async function runSession(
  turns: LongSessionTurn[],
  mode: SessionMode,
  opts: LongEvalOptions
): Promise<LongSessionResult> {
  const rounds: SessionRound[] = [];
  // Accumulates the full conversation history across all rounds
  const history: Message[] = [];

  for (const turn of turns) {
    const userMsg: Message = {
      id: randomUUID(),
      role: "user",
      content: turn.userMessage,
      timestamp: Date.now(),
    };
    history.push(userMsg);

    const rawContext: Context = {
      messages: [...history],
      systemPrompt:
        "You are a senior TypeScript engineer helping build the ContextEngine middleware project. " +
        "Be specific, technical, and reference decisions made earlier in the session when relevant.",
    };

    const historyTokens = estimateTokens(rawContext);

    let contextToSend: Context;
    let pipelineStats: SessionRound["pipelineStats"] | undefined;
    let compressedHistoryTokens: number | undefined;

    if (mode === "optimized") {
      const config: PipelineConfig = await loadConfig({
        maxTokens: opts.maxTokens,
        targetTokens: opts.targetTokens,
        memoryEnabled: true,
        provider: opts.provider === "mock" ? "claude" : opts.provider,
        model: opts.model,
      });
      const pipeline = new Pipeline();
      const result = await pipeline.run(rawContext, config);
      contextToSend = result.context;
      compressedHistoryTokens = estimateTokens(contextToSend);
      pipelineStats = {
        originalTokens: result.stats.originalTokens,
        outputTokens: result.stats.outputTokens,
        compressionRatio: result.stats.compressionRatio,
        messagesDropped: result.stats.messagesDropped,
      };
    } else {
      contextToSend = rawContext;
    }

    const provider = createProvider(opts.provider, opts.model);

    const t0 = Date.now();
    const response = await provider.send({ context: contextToSend, maxTokens: 1024 });
    const latencyMs = Date.now() - t0;

    const { score } = scoreHeuristic(
      { id: `turn-${turn.id}`, type: turn.topic as never, name: turn.topic, prompt: turn.userMessage, expectedKeywords: turn.expectedKeywords, expectedStructure: { headers: true, bullets: true } },
      response.content
    );

    let judgeScore: number | undefined;
    if (opts.judgeEnabled) {
      judgeScore = await scoreWithJudge(
        { id: `t${turn.id}`, type: turn.topic as never, name: turn.topic, prompt: turn.userMessage, expectedKeywords: turn.expectedKeywords, expectedStructure: {} },
        response.content
      );
    }

    const round: SessionRound = {
      turnId: turn.id,
      topic: turn.topic,
      mode,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      historyTokens,
      compressedHistoryTokens,
      response: response.content,
      qualityScore: judgeScore !== undefined ? round2(score * 0.4 + judgeScore * 0.6) : score,
      judgeScore,
      latencyMs,
      pipelineStats,
    };
    rounds.push(round);

    // Append the assistant's response to history for the next round
    const assistantMsg: Message = {
      id: randomUUID(),
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
    };
    history.push(assistantMsg);
  }

  const metrics = computeMetrics(rounds, turns);
  return { mode, rounds, metrics };
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}
