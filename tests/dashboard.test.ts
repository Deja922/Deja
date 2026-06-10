import { describe, expect, test } from "vitest";
import { renderDashboard } from "../src/proxy/dashboard.js";

const base = {
  requests: 10,
  compressed: 5,
  skipped: 3,
  passthrough: 2,
  totalOriginalTokens: 8000,
  totalOutputTokens: 4000,
  startTime: Date.now() - 60000,
  upstreamOk: true,
  retryCount: 0,
  mode: "production",
  targetTokens: 4000,
  maxTokens: 8000,
  compressThreshold: 200,
  lastRequestTokens: 500,
  lastRequestCompressed: true,
};

describe("renderDashboard — license UI", () => {
  test("FREE under limit: no banner, shows usage card with green bar", () => {
    const html = renderDashboard({
      ...base,
      licenseTier: "free",
      licenseMonthlyUsage: 42,
      licenseMonthlyLimit: 100,
      licenseLimitReached: false,
    });

    expect(html).not.toContain('class="banner banner-limit"');
    expect(html).not.toContain("免费版已达月限");
    expect(html).toContain("42 / 100");
    expect(html).toContain("FREE");
    expect(html).toContain("background:#238636");
  });

  test("FREE over limit: shows red banner + red bar + 已达上限 badge", () => {
    const html = renderDashboard({
      ...base,
      licenseTier: "free",
      licenseMonthlyUsage: 100,
      licenseMonthlyLimit: 100,
      licenseLimitReached: true,
    });

    expect(html).toContain("banner-limit");
    expect(html).toContain("免费版已达月限");
    expect(html).toContain("100 / 100");
    expect(html).toContain("background:#f85149");
    expect(html).toContain("已达上限");
  });

  test("PRO: no banner, no limit shown, PRO badge, unlimited usage row", () => {
    const html = renderDashboard({
      ...base,
      licenseTier: "pro",
      licenseEmail: "user@example.com",
      licenseMonthlyUsage: 300,
      licenseMonthlyLimit: null,
      licenseLimitReached: false,
    });

    expect(html).not.toContain('class="banner banner-limit"');
    expect(html).not.toContain("已达上限");
    expect(html).toContain("PRO");
    expect(html).toContain("user@example.com");
    expect(html).toContain("无限制");
  });
});
