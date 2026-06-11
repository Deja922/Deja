// Monthly compression usage tracker.
// Data is stored in ~/.deja/usage.json and auto-resets each month.
//
// Public beta policy:
// - Free users are unlimited by default (no charge during beta).
// - Set DEJA_BETA_FREE_UNLIMITED=0 to re-enable FREE_MONTHLY_LIMIT enforcement.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { getLicenseStatus } from "./license.js";

export const FREE_MONTHLY_LIMIT = 100;
export const BETA_FREE_UNLIMITED = process.env["DEJA_BETA_FREE_UNLIMITED"] !== "0";

const USAGE_PATH = join(homedir(), ".deja", "usage.json");

interface UsageData {
  month: string; // YYYY-MM
  count: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readUsage(): UsageData {
  if (!existsSync(USAGE_PATH)) return { month: currentMonth(), count: 0 };
  try {
    const raw = JSON.parse(readFileSync(USAGE_PATH, "utf-8")) as UsageData;
    if (raw.month !== currentMonth()) return { month: currentMonth(), count: 0 };
    return raw;
  } catch {
    return { month: currentMonth(), count: 0 };
  }
}

function writeUsage(data: UsageData): void {
  const dir = dirname(USAGE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(USAGE_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function incrementUsage(): void {
  const data = readUsage();
  data.count++;
  writeUsage(data);
}

export interface UsageStatus {
  month: string;
  count: number;
  limit: number | null; // null = unlimited
  limitReached: boolean;
}

export function getUsageStatus(): UsageStatus {
  const lic = getLicenseStatus();
  const data = readUsage();

  // Paid license: always unlimited.
  if (lic.valid) {
    return { month: data.month, count: data.count, limit: null, limitReached: false };
  }

  // Public beta: free users are unlimited unless explicitly disabled.
  if (BETA_FREE_UNLIMITED) {
    return { month: data.month, count: data.count, limit: null, limitReached: false };
  }

  return {
    month: data.month,
    count: data.count,
    limit: FREE_MONTHLY_LIMIT,
    limitReached: data.count >= FREE_MONTHLY_LIMIT,
  };
}
