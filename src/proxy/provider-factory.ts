import type { IProvider } from "@/providers/index.js";
import { ClaudeProvider } from "@/providers/claude.js";
import { OpenAIProvider } from "@/providers/openai.js";
import { MockProvider } from "./mock-provider.js";

export function createProvider(
  type: "claude" | "openai" | "mock",
  model: string
): IProvider {
  if (type === "mock") return new MockProvider("mock");

  if (type === "claude") {
    if (process.env["ANTHROPIC_API_KEY"]) return new ClaudeProvider(model);
    console.warn("⚠  ANTHROPIC_API_KEY not set — using mock provider");
    return new MockProvider("claude-mock");
  }

  if (type === "openai") {
    if (process.env["OPENAI_API_KEY"]) return new OpenAIProvider(model);
    console.warn("⚠  OPENAI_API_KEY not set — using mock provider");
    return new MockProvider("openai-mock");
  }

  return new MockProvider("fallback");
}
