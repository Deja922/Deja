import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { MemoryEntry } from "@/types/index.js";

interface MemoryDB {
  version: 1;
  entries: MemoryEntry[];
}

/**
 * Lightweight JSON file store.
 * All reads/writes are synchronous to keep the API simple;
 * the file is small (< a few thousand entries before you'd want SQLite).
 */
export class JsonDB {
  private path: string;
  private cache: MemoryDB;

  constructor(dbPath: string) {
    this.path = dbPath;
    this.cache = this.load();
  }

  getAll(): MemoryEntry[] {
    return this.cache.entries;
  }

  insert(entry: MemoryEntry): void {
    this.cache.entries.push(entry);
    this.persist();
  }

  clear(): void {
    this.cache.entries = [];
    this.persist();
  }

  // ── private ──────────────────────────────────────────────────────────

  private load(): MemoryDB {
    if (!existsSync(this.path)) {
      return { version: 1, entries: [] };
    }
    try {
      return JSON.parse(readFileSync(this.path, "utf-8")) as MemoryDB;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}
