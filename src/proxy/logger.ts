import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ComparisonReport } from "./types.js";

export class RunLogger {
  private dir: string;

  constructor(logDir: string) {
    this.dir = logDir;
  }

  save(report: ComparisonReport): string {
    mkdirSync(this.dir, { recursive: true });

    const filename = `run-${report.runId}.json`;
    const path = join(this.dir, filename);
    writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");

    // Append one-liner to runs index
    const indexPath = join(this.dir, "index.jsonl");
    const line = JSON.stringify({
      runId: report.runId,
      timestamp: report.timestamp,
      prompt: report.prompt.slice(0, 80),
      tokenSavings: report.tokenSavingsPct,
      qualityDelta: report.qualityDelta,
    });
    const existing = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
    writeFileSync(indexPath, existing + line + "\n", "utf-8");

    return path;
  }
}
