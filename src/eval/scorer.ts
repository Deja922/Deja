import type { EvalTask, ScoreBreakdown } from "./types.js";

// ── Heuristic scorer ──────────────────────────────────────────────────────
// Scores a response 0–10 using purely local heuristics (no API required).
// Dimensions: structure, keyword coverage, length, format fit.

export function scoreHeuristic(task: EvalTask, response: string): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const breakdown: ScoreBreakdown = {
    structure: scoreStructure(response, task.expectedStructure),
    keywordCoverage: scoreKeywords(response, task.expectedKeywords),
    length: scoreLength(response),
    format: scoreFormat(response, task.type),
  };

  const score =
    breakdown.structure * 0.25 +
    breakdown.keywordCoverage * 0.35 +
    breakdown.length * 0.20 +
    breakdown.format * 0.20;

  return { score: round(score), breakdown };
}

function scoreStructure(
  response: string,
  expected: EvalTask["expectedStructure"]
): number {
  let hits = 0;
  let total = 0;

  if (expected.headers !== undefined) {
    total++;
    if (expected.headers && /^#{1,4}\s+\S/m.test(response)) hits++;
    if (!expected.headers) hits++; // not expected = always pass
  }
  if (expected.bullets !== undefined) {
    total++;
    if (expected.bullets && /^[-*•]\s+\S/m.test(response)) hits++;
    if (!expected.bullets) hits++;
  }
  if (expected.numberedList !== undefined) {
    total++;
    if (expected.numberedList && /^\d+\.\s+\S/m.test(response)) hits++;
    if (!expected.numberedList) hits++;
  }
  if (expected.codeBlocks !== undefined) {
    total++;
    if (expected.codeBlocks && /```[\s\S]*?```/.test(response)) hits++;
    if (!expected.codeBlocks) hits++;
  }

  if (total === 0) return 7; // no expectations — neutral score
  return round((hits / total) * 10);
}

function scoreKeywords(response: string, keywords: string[]): number {
  if (keywords.length === 0) return 7;
  const lower = response.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
  return round((hits / keywords.length) * 10);
}

function scoreLength(response: string): number {
  const words = response.trim().split(/\s+/).length;
  if (words < 30) return 2;
  if (words < 80) return 5;
  if (words < 150) return 7;
  if (words < 400) return 9;
  return 10;
}

function scoreFormat(response: string, type: EvalTask["type"]): number {
  switch (type) {
    case "coding":
      // Code blocks are essential; bonus for explanation
      return /```[\s\S]*?```/.test(response) ? 10 : 3;
    case "planning":
      // Sections + timeline markers
      return /week\s*\d|phase\s*\d|milestone|deadline/i.test(response) ? 10 : 5;
    case "reasoning":
      // Shows reasoning steps
      return /step \d|first[,:]|then[,:]|therefore|root cause|conclusion/i.test(response) ? 10 : 5;
    case "summarization":
      // Structured sections
      return /#{1,4}\s+\S/m.test(response) ? 10 : 5;
    case "agent_workflow":
      // Both code and structure
      return /```[\s\S]*?```/.test(response) && /#{1,4}\s+\S/m.test(response) ? 10 : 5;
    default:
      return 7;
  }
}

// ── Claude judge scorer ───────────────────────────────────────────────────
// Calls Claude to judge the response quality 0–10 with reasoning.
// Only activated when --judge flag is passed.

export async function scoreWithJudge(
  task: EvalTask,
  response: string,
  apiKey?: string
): Promise<number> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const judgePrompt = `You are evaluating an AI assistant's response.

TASK TYPE: ${task.type}
TASK NAME: ${task.name}

ORIGINAL PROMPT:
${task.prompt}

AI RESPONSE TO EVALUATE:
${response}

Score this response from 0 to 10 on overall quality, considering:
- Completeness: does it address all parts of the prompt?
- Accuracy: is the content technically correct?
- Structure: is it well-organized and easy to follow?
- Depth: does it go beyond surface-level?

Respond with ONLY a JSON object: {"score": <number 0-10>, "reasoning": "<one sentence>"}`;

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{ role: "user", content: judgePrompt }],
  });

  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as {
      score?: number;
    };
    return typeof parsed.score === "number"
      ? Math.min(10, Math.max(0, parsed.score))
      : 5;
  } catch {
    return 5;
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
