/**
 * Hash-based bag-of-words embedding.
 *
 * Maps each token to a fixed bucket via djb2 hash, accumulates counts,
 * then L2-normalizes. No vocabulary needed — new texts don't invalidate
 * existing embeddings. Dimensionality is fixed at `dims` (default 256).
 *
 * Good enough for keyword-overlap similarity; swap for OpenAI/local BERT
 * embeddings by implementing IEmbedder and passing it to MemoryStore.
 */

export interface IEmbedder {
  embed(text: string): Promise<number[]>;
  readonly dims: number;
}

export class LocalEmbedder implements IEmbedder {
  readonly dims: number;

  constructor(dims = 256) {
    this.dims = dims;
  }

  async embed(text: string): Promise<number[]> {
    const tokens = tokenize(text);
    const vec = new Array<number>(this.dims).fill(0);

    for (const t of tokens) {
      const idx = djb2(t) % this.dims;
      vec[idx]! += 1;
    }

    return l2normalize(vec);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return hash;
}

function l2normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec;
  return vec.map((v) => v / magnitude);
}
