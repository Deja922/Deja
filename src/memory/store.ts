import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Context, Message, MemoryEntry, PipelineConfig } from "@/types/index.js";
import type { IMemoryStore } from "./index.js";
import { LocalEmbedder, type IEmbedder } from "./embeddings.js";
import { cosine, topK } from "./similarity.js";
import { JsonDB } from "./db.js";

const DEFAULT_DB_PATH = join(homedir(), ".context-engine", "memory.json");
const MIN_SIMILARITY = 0.15; // ignore hits below this threshold

export class MemoryStore implements IMemoryStore {
  private db: JsonDB;
  private embedder: IEmbedder;

  constructor(dbPath = DEFAULT_DB_PATH, embedder?: IEmbedder) {
    this.db = new JsonDB(dbPath);
    this.embedder = embedder ?? new LocalEmbedder();
  }

  async store(content: string, tags?: string[]): Promise<void> {
    const embedding = await this.embedder.embed(content);
    const entry: MemoryEntry = {
      id: randomUUID(),
      content,
      embedding,
      createdAt: Date.now(),
      ...(tags !== undefined ? { tags } : {}),
    };
    this.db.insert(entry);
  }

  async inject(context: Context, config: PipelineConfig): Promise<Context> {
    const entries = this.db.getAll();
    if (entries.length === 0) return context;

    // Build query from the last few user messages
    const query = buildQuery(context);
    if (!query) return context;

    const queryVec = await this.embedder.embed(query);

    // Score all entries
    const scores = entries.map((e) => cosine(queryVec, e.embedding));
    const indices = topK(scores, config.memoryTopK);

    // Filter below threshold and sort by similarity desc
    const hits = indices
      .map((i) => ({ entry: entries[i]!, score: scores[i]! }))
      .filter(({ score }) => score >= MIN_SIMILARITY);

    if (hits.length === 0) return context;

    // Build a single injected system message from all hits
    const memoryBlock = formatMemoryBlock(hits.map(({ entry }) => entry));
    const memoryMessage: Message = {
      id: `memory-${Date.now()}`,
      role: "system",
      content: memoryBlock,
      timestamp: Date.now(),
      source: "memory",
    };

    // Prepend after any existing system messages
    const messages = injectAfterSystem(context.messages, memoryMessage);
    return { ...context, messages };
  }

  async clear(): Promise<void> {
    this.db.clear();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function buildQuery(context: Context): string {
  const recent = context.messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content)
    .join(" ");
  return recent.trim();
}

function formatMemoryBlock(entries: MemoryEntry[]): string {
  const lines = entries.map((e, i) => `${i + 1}. ${e.content.slice(0, 200)}`);
  return `[Relevant memory context]\n${lines.join("\n")}`;
}

function injectAfterSystem(messages: Message[], injection: Message): Message[] {
  const lastSystemIdx = messages.reduce(
    (last, m, i) => (m.role === "system" ? i : last),
    -1
  );
  const insertAt = lastSystemIdx + 1;
  return [
    ...messages.slice(0, insertAt),
    injection,
    ...messages.slice(insertAt),
  ];
}
