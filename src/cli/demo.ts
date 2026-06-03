#!/usr/bin/env node
/**
 * Context Engine — 60-second terminal demo
 *
 * Uses real benchmark data from our 20-round eval run.
 * Record with: npx asciinema rec demo.cast --command "npx tsx src/cli/demo.ts"
 * Convert to GIF: npx agg demo.cast demo.gif --theme monokai
 */

// ── Real benchmark data (from actual Claude Sonnet API runs) ──────────────
const BASELINE_TOKENS =  [108, 1208, 2340, 3447, 4568, 5688, 6820, 7929, 9037, 10153, 11251, 12345, 13474, 14591, 15692, 16805, 17913, 19008, 20124, 21220];
const OPTIMIZED_TOKENS = [108, 1208, 2340, 2288, 1239, 1251, 2301, 2290, 2358,  2342,  3370,  3357,  3446,  3448,  4490,  4510,  4577,  4544,  5583,  5578];
const BASELINE_QUALITY =  [8.2, 7.1, 7.1, 7.7, 7.3, 6.4, 8.2, 8.2, 7.3, 6.0, 7.3, 7.7, 7.3, 7.7, 7.3, 6.0, 7.7, 8.2, 6.9, 8.2];
const OPTIMIZED_QUALITY = [7.7, 8.9, 9.4, 9.4, 8.5, 6.4, 8.2, 8.4, 7.7, 7.3, 8.2, 7.7, 7.7, 7.7, 8.2, 9.4, 8.2, 8.2, 7.3, 9.4];
const TOPICS = [
  "architecture","architecture","refactor","bug fixing","memory system",
  "provider router","refactor","bug fixing","cli optimization","testing",
  "deployment","architecture","refactor","bug fixing","provider router",
  "testing","cli optimization","deployment","refactor","deployment",
];
const MEMORY_CHECKPOINTS = new Set([8, 12, 16, 20]);

const TOTAL_ROUNDS = 20;
const ROUND_DELAY_MS = 1800;
const INTRO_MS = 2200;
const OUTRO_MS = 3000;

// ── ANSI helpers ──────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[97m",
  bgRed:  "\x1b[41m",
  bgGreen:"\x1b[42m",
  clear:  "\x1b[2J\x1b[H",
  hide:   "\x1b[?25l",
  show:   "\x1b[?25h",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function bar(val: number, max: number, width: number, color: string): string {
  const filled = Math.round((val / max) * width);
  return color + "█".repeat(filled) + C.dim + "░".repeat(width - filled) + C.reset;
}

function pct(base: number, opt: number): string {
  const p = ((base - opt) / base) * 100;
  return p > 0 ? `${C.green}-${p.toFixed(1)}%${C.reset}` : `${C.red}+${Math.abs(p).toFixed(1)}%${C.reset}`;
}

// ── Mini token growth sparkline ───────────────────────────────────────────

function sparkline(values: number[], current: number, width: number, color: string): string {
  const slice = values.slice(0, current + 1);
  const max = Math.max(...BASELINE_TOKENS);
  return slice.map((v) => {
    const h = Math.max(1, Math.round((v / max) * 4));
    const chars = ["▁","▂","▃","▄","▅","▆","▇","█"];
    return color + chars[Math.min(h, chars.length - 1)];
  }).join("") + C.reset;
}

// ── Main frame renderer ───────────────────────────────────────────────────

function renderFrame(round: number): void {
  const i = round - 1;
  const bTok = BASELINE_TOKENS[i];
  const oTok = OPTIMIZED_TOKENS[i];
  const bQ = BASELINE_QUALITY[i];
  const oQ = OPTIMIZED_QUALITY[i];
  const maxTok = 22000;
  const barW = 22;
  const isCheckpoint = MEMORY_CHECKPOINTS.has(round);

  const W = 72;
  const divider = "│";
  const sep = "─".repeat(W);

  const line = (left: string, right: string, leftW = 34) => {
    const lPlain = left.replace(/\x1b\[[0-9;]*m/g, "");
    const lPad = Math.max(0, leftW - lPlain.length);
    return `${divider} ${left}${" ".repeat(lPad)} ${divider} ${right}`;
  };

  process.stdout.write(C.clear);

  // Title
  console.log(`${C.bold}${C.cyan}  Context Engine${C.reset}${C.dim} — Live Session Comparison${C.reset}`);
  console.log(`  ${C.dim}${sep}${C.reset}`);
  console.log(`  ${divider} ${C.bold}${C.red} WITHOUT Context Engine${C.reset}         ${divider} ${C.bold}${C.green} WITH Context Engine${C.reset}`);
  console.log(`  ├${"─".repeat(35)}┼${"─".repeat(35)}┤`);

  // Round
  const roundLabel = `Round ${round} / ${TOTAL_ROUNDS}` + (isCheckpoint ? ` ${C.yellow}★ memory checkpoint${C.reset}` : "");
  console.log(`  ${line(`${C.dim}Round ${round} / ${TOTAL_ROUNDS}${isCheckpoint ? ` ${C.yellow}★${C.reset}` : ""}${C.reset}`, `${C.dim}Round ${round} / ${TOTAL_ROUNDS}${isCheckpoint ? ` ${C.yellow}★${C.reset}` : ""}${C.reset}`)}`);
  console.log(`  ${line(`${C.dim}Topic: ${TOPICS[i].padEnd(20)}${C.reset}`, `${C.dim}Topic: ${TOPICS[i].padEnd(20)}${C.reset}`)}`);
  console.log(`  ${divider}${" ".repeat(36)}${divider}${" ".repeat(36)}`);

  // Tokens
  const tokDiff = pct(bTok, oTok);
  console.log(`  ${line(
    `${C.bold}${C.red}${fmt(bTok).padStart(8)} tokens${C.reset}`,
    `${C.bold}${C.green}${fmt(oTok).padStart(8)} tokens${C.reset}  ${tokDiff}`
  )}`);

  // Bars
  console.log(`  ${line(
    bar(bTok, maxTok, barW, C.red),
    bar(oTok, maxTok, barW, C.green)
  )}`);
  console.log(`  ${divider}${" ".repeat(36)}${divider}${" ".repeat(36)}`);

  // Quality
  const qColor = oQ >= bQ ? C.green : C.yellow;
  console.log(`  ${line(
    `${C.dim}Quality ${C.reset}${C.bold}${bQ.toFixed(1)}${C.reset}${C.dim} / 10${C.reset}`,
    `${C.dim}Quality ${C.reset}${C.bold}${qColor}${oQ.toFixed(1)}${C.reset}${C.dim} / 10${C.reset}`
  )}`);
  console.log(`  ├${"─".repeat(35)}┴${"─".repeat(35)}┤`);

  // Growth curve
  const bSpark = sparkline(BASELINE_TOKENS, i, TOTAL_ROUNDS, C.red);
  const oSpark = sparkline(OPTIMIZED_TOKENS, i, TOTAL_ROUNDS, C.green);
  console.log(`  ${divider} ${C.dim}Token growth:${C.reset}`);
  console.log(`  ${divider}  ${C.red}baseline ${C.reset} ${bSpark}`);
  console.log(`  ${divider}  ${C.green}optimized${C.reset} ${oSpark}`);
  console.log(`  └${"─".repeat(71)}`);

  // Running totals
  const bTotal = BASELINE_TOKENS.slice(0, round).reduce((a, b) => a + b, 0);
  const oTotal = OPTIMIZED_TOKENS.slice(0, round).reduce((a, b) => a + b, 0);
  const savedSoFar = bTotal - oTotal;
  const savedPct = ((savedSoFar / bTotal) * 100).toFixed(1);

  if (savedSoFar > 0) {
    console.log(`\n  ${C.dim}Cumulative:${C.reset}  ${C.red}${fmt(bTotal)}${C.reset} baseline  vs  ${C.green}${fmt(oTotal)}${C.reset} optimized  →  ${C.bold}${C.green}${fmt(savedSoFar)} tokens saved (${savedPct}%)${C.reset}`);
  } else {
    console.log(`\n  ${C.dim}Sessions identical so far — compression kicks in as history grows...${C.reset}`);
  }
}

// ── Final benchmark screen ────────────────────────────────────────────────

function renderFinal(): void {
  process.stdout.write(C.clear);

  console.log(`\n  ${C.bold}${C.cyan}Context Engine${C.reset}  ${C.dim}— 20-round benchmark results${C.reset}\n`);

  const rows: [string, string, string, string][] = [
    ["Total prompt tokens", "213,721", "60,628",  "-71.6%"],
    ["Final round tokens",  " 21,220", " 5,578",  "-73.7%"],
    ["Avg response quality","    7.4", "   8.2",  "  +0.8"],
    ["Memory retention",    "  10/10", " 10/10",  "    ✓ "],
  ];

  const W = { metric: 24, val: 10, delta: 8 };
  const top = `  ┌${"─".repeat(W.metric+2)}┬${"─".repeat(W.val+2)}┬${"─".repeat(W.val+2)}┬${"─".repeat(W.delta+2)}┐`;
  const mid = `  ├${"─".repeat(W.metric+2)}┼${"─".repeat(W.val+2)}┼${"─".repeat(W.val+2)}┼${"─".repeat(W.delta+2)}┤`;
  const bot = `  └${"─".repeat(W.metric+2)}┴${"─".repeat(W.val+2)}┴${"─".repeat(W.val+2)}┴${"─".repeat(W.delta+2)}┘`;

  const row = (m: string, b: string, o: string, d: string, highlight = false) => {
    const dc = highlight ? C.bold + C.green : C.green;
    return `  │ ${m.padEnd(W.metric)} │ ${C.red}${b.padStart(W.val)}${C.reset} │ ${C.green}${o.padStart(W.val)}${C.reset} │ ${dc}${d.padStart(W.delta)}${C.reset} │`;
  };

  console.log(top);
  console.log(`  │ ${"Metric".padEnd(W.metric)} │ ${"Baseline".padStart(W.val)} │ ${"Optimized".padStart(W.val)} │ ${"Δ".padStart(W.delta)} │`);
  console.log(mid);
  for (const [m, b, o, d] of rows) {
    console.log(row(m, b, o, d, m.includes("Total")));
  }
  console.log(bot);

  console.log(`\n  ${C.bold}${C.green}71.6% fewer tokens. Better quality. Zero memory loss.${C.reset}`);
  console.log(`\n  ${C.dim}github.com/your-org/context-engine${C.reset}\n`);
}

// ── Run ───────────────────────────────────────────────────────────────────

(async () => {
  process.stdout.write(C.hide);

  try {
    // Intro screen
    process.stdout.write(C.clear);
    console.log(`\n\n  ${C.bold}${C.cyan}Context Engine${C.reset}\n`);
    console.log(`  ${C.dim}What happens to your Claude Code session after 20 rounds?${C.reset}\n`);
    console.log(`  ${C.red}Without:${C.reset}  tokens grow  108  →  21,220  every request`);
    console.log(`  ${C.green}With:    ${C.reset}  tokens stay  108  →   5,578  — compressed\n`);
    console.log(`  ${C.dim}Starting live comparison...${C.reset}`);
    await sleep(INTRO_MS);

    // Round-by-round animation
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      renderFrame(round);
      await sleep(ROUND_DELAY_MS);
    }

    // Final benchmark
    renderFinal();
    await sleep(OUTRO_MS);

  } finally {
    process.stdout.write(C.show);
  }
})();
