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

const WORKFLOW_PROMPTS: Record<string, string> = {
  coding:
    "You are a senior TypeScript engineer helping build the ContextEngine middleware project. " +
    "Be specific, technical, and reference decisions made earlier in the session when relevant.",
  planning:
    "You are a senior product manager and technical architect planning a complex product launch. " +
    "Be analytical, structured, and always reference earlier decisions and constraints. " +
    "Use frameworks (MoSCoW, risk matrices, phase planning) consistently.",
  agent:
    "You are a senior SRE designing and operating OpsBot, an AI agent for automated DevOps incident response. " +
    "Be precise, safety-conscious, and always consider blast radius, guardrails, and rollback procedures. " +
    "Reference earlier incidents and design decisions when relevant.",
};

export async function runSession(
  turns: LongSessionTurn[],
  mode: SessionMode,
  workflow: "coding" | "planning" | "agent",
  opts: LongEvalOptions
): Promise<LongSessionResult> {
  const rounds: SessionRound[] = [];
  const history: Message[] = [];
  const protocolErrors: { turnId: number; error: string }[] = [];

  for (const turn of turns) {
    const userMsg: Message = {
      id: randomUUID(),
      role: "user",
      content: turn.userMessage,
      timestamp: Date.now(),
    };
    history.push(userMsg);

    const sysPrompt = (WORKFLOW_PROMPTS[workflow] ?? WORKFLOW_PROMPTS["coding"]) as string;
    const rawContext: Context = {
      messages: [...history],
      systemPrompt: sysPrompt,
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
    let protocolError: string | undefined;
    let response: { content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } };

    try {
      response = await provider.send({ context: contextToSend, maxTokens: 1024 });
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      if (msg.includes("signature")) protocolError = "signature";
      else if (msg.includes("thinking")) protocolError = "thinking";
      else if (msg.includes("rate") || msg.includes("429")) protocolError = "rate_limit";
      else if (msg.includes("timeout")) protocolError = "timeout";
      else if (msg.includes("tls") || msg.includes("socket")) protocolError = "network";
      else protocolError = `unknown: ${(err as Error).message.slice(0, 60)}`;

      protocolErrors.push({ turnId: turn.id, error: protocolError });

      response = {
        content: `[ERROR: ${protocolError}]`,
        usage: { promptTokens: historyTokens, completionTokens: 0, totalTokens: historyTokens },
      };
    }
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
      ...(compressedHistoryTokens !== undefined ? { compressedHistoryTokens } : {}),
      response: response.content,
      qualityScore: judgeScore !== undefined ? round2(score * 0.4 + judgeScore * 0.6) : score,
      ...(judgeScore !== undefined ? { judgeScore } : {}),
      latencyMs,
      ...(protocolError !== undefined ? { protocolError } : {}),
      ...(pipelineStats !== undefined ? { pipelineStats } : {}),
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
  return { mode, rounds, metrics, protocolErrors: protocolErrors.length };
}

function round2(n: number): number {
  return Math.round(n * 10) / 10;
}
