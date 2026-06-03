#!/usr/bin/env node
// Deja — 60-second terminal demo
// Real benchmark data from 20-round Claude Sonnet API session.

// ── Data ─────────────────────────────────────────────────────────────────────
const BASELINE_TOKENS  = [108,1208,2340,3447,4568,5688,6820,7929,9037,10153,11251,12345,13474,14591,15692,16805,17913,19008,20124,21220];
const OPTIMIZED_TOKENS = [108,1208,2340,2288,1239,1251,2301,2290,2358, 2342, 3370, 3357, 3446, 3448, 4490, 4510, 4577, 4544, 5583, 5578];
const BASELINE_QUALITY  = [8.2,7.1,7.1,7.7,7.3,6.4,8.2,8.2,7.3,6.0,7.3,7.7,7.3,7.7,7.3,6.0,7.7,8.2,6.9,8.2];
const OPTIMIZED_QUALITY = [7.7,8.9,9.4,9.4,8.5,6.4,8.2,8.4,7.7,7.3,8.2,7.7,7.7,7.7,8.2,9.4,8.2,8.2,7.3,9.4];
const TOPICS = [
  "architecture","architecture","refactor","bug fixing","memory system",
  "provider router","refactor","bug fixing","cli optimization","testing",
  "deployment","architecture","refactor","bug fixing","provider router",
  "testing","cli optimization","deployment","refactor","deployment",
];
const CHECKPOINTS = new Set([8,12,16,20]);

// ── Timing (total ≈ 60s) ──────────────────────────────────────────────────────
const INTRO_MS   = 5000;
const ROUND_MS   = 2500;   // 20 rounds × 2500 = 50 000 ms
const OUTRO_MS   = 5000;
const TOTAL_ROUNDS = 20;

// ── ANSI ──────────────────────────────────────────────────────────────────────
const A = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  clear:  "\x1b[2J\x1b[H",
  hide:   "\x1b[?25l",
  show:   "\x1b[?25h",
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Strip ANSI codes to measure real visible length
function vlen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// Pad a string (which may contain ANSI codes) to a given visible width
function pad(s: string, w: number, align: "l"|"r" = "l"): string {
  const v = vlen(s);
  const spaces = " ".repeat(Math.max(0, w - v));
  return align === "r" ? spaces + s : s + spaces;
}

// ── Box geometry ──────────────────────────────────────────────────────────────
const COLW = 37;  // visible chars per column (excluding borders and padding)
// Row layout: │ [COLW] │ [COLW] │  → total visible = COLW*2 + 6 + 1 = COLW*2+7
// With COLW=37: 37*2+7 = 81 chars wide

function boxRow(left: string, right: string): string {
  return `  │ ${pad(left, COLW)} │ ${pad(right, COLW)} │`;
}

function spanRow(content: string): string {
  // Full-width row spanning both columns: │ [COLW*2+3] │
  return `  │ ${pad(content, COLW * 2 + 3)} │`;
}

const BOX_TOP = `  ┌${"─".repeat(COLW+2)}┬${"─".repeat(COLW+2)}┐`;
const BOX_MID = `  ├${"─".repeat(COLW+2)}┼${"─".repeat(COLW+2)}┤`;
const BOX_DIV = `  ├${"─".repeat(COLW+2)}┴${"─".repeat(COLW+2)}┤`;  // merge cols
const BOX_BOT = `  └${"─".repeat(COLW*2+5)}┘`;
const BOX_SEP = `  │ ${" ".repeat(COLW)} │ ${" ".repeat(COLW)} │`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function numFmt(n: number): string { return n.toLocaleString(); }

function tokenBar(val: number, max: number, w: number, color: string): string {
  const filled = Math.round((val / max) * w);
  return color + "█".repeat(filled) + A.dim + "░".repeat(w - filled) + A.reset;
}

function savingsBadge(base: number, opt: number): string {
  if (base === opt) return A.dim + "      —" + A.reset;
  const p = ((base - opt) / base) * 100;
  return p > 0
    ? A.bold + A.green + `-${p.toFixed(1)}%` + A.reset
    : A.red   + `+${Math.abs(p).toFixed(1)}%` + A.reset;
}

function sparkline(data: number[], upTo: number, color: string): string {
  const max = Math.max(...BASELINE_TOKENS);
  const bars = ["▁","▂","▃","▄","▅","▆","▇","█"];
  return data.slice(0, upTo + 1).map(v => {
    const h = Math.max(0, Math.round((v / max) * (bars.length - 1)));
    return color + bars[h];
  }).join("") + A.reset;
}

// ── Screens ───────────────────────────────────────────────────────────────────

function renderIntro(): void {
  process.stdout.write(A.clear);
  console.log(`\n`);
  console.log(`  ${A.bold}${A.cyan}Deja${A.reset}  ${A.dim}— context compression for AI coding sessions${A.reset}\n`);
  console.log(`  ${A.dim}What happens after 20 rounds in Claude Code / Cursor?${A.reset}\n`);
  console.log(`  ${A.red}Without Deja:${A.reset}  round 1 →  ${A.bold}108${A.reset} tokens   round 20 → ${A.bold}${A.red}21,220${A.reset} tokens`);
  console.log(`  ${A.green}With Deja:   ${A.reset}  round 1 →  ${A.bold}108${A.reset} tokens   round 20 → ${A.bold}${A.green} 5,578${A.reset} tokens\n`);
  console.log(`  ${A.dim}Running live comparison — 20 rounds...${A.reset}\n`);
}

function renderFrame(round: number): void {
  const i        = round - 1;
  const bTok     = BASELINE_TOKENS[i];
  const oTok     = OPTIMIZED_TOKENS[i];
  const bQ       = BASELINE_QUALITY[i];
  const oQ       = OPTIMIZED_QUALITY[i];
  const isCkpt   = CHECKPOINTS.has(round);
  const maxTok   = 22000;
  const barW     = 20;

  const bTotal   = BASELINE_TOKENS.slice(0,round).reduce((a,b)=>a+b,0);
  const oTotal   = OPTIMIZED_TOKENS.slice(0,round).reduce((a,b)=>a+b,0);
  const saved    = bTotal - oTotal;
  const savedPct = bTotal > 0 ? ((saved/bTotal)*100).toFixed(1) : "0.0";

  process.stdout.write(A.clear);

  // Header
  console.log(`  ${A.bold}${A.cyan}Deja${A.reset}${A.dim} — Live Session Comparison${A.reset}`);
  console.log(BOX_TOP);
  console.log(boxRow(
    `${A.bold}${A.red} ✗  WITHOUT Deja${A.reset}`,
    `${A.bold}${A.green} ✓  WITH Deja${A.reset}`,
  ));
  console.log(BOX_MID);

  // Round + topic
  const ckptTag = isCkpt ? `  ${A.yellow}★ checkpoint${A.reset}` : "";
  console.log(boxRow(
    `${A.dim}Round ${A.reset}${A.bold}${round}${A.reset}${A.dim} / ${TOTAL_ROUNDS}${A.reset}${ckptTag}`,
    `${A.dim}Round ${A.reset}${A.bold}${round}${A.reset}${A.dim} / ${TOTAL_ROUNDS}${A.reset}${ckptTag}`,
  ));
  console.log(boxRow(
    `${A.dim}Topic: ${A.reset}${TOPICS[i]}`,
    `${A.dim}Topic: ${A.reset}${TOPICS[i]}`,
  ));
  console.log(BOX_SEP);

  // Token counts
  const badge = savingsBadge(bTok, oTok);
  console.log(boxRow(
    `${A.bold}${A.red}${pad(numFmt(bTok), 8, "r")} tokens${A.reset}`,
    `${A.bold}${A.green}${pad(numFmt(oTok), 8, "r")} tokens${A.reset}  ${badge}`,
  ));
  console.log(BOX_SEP);

  // Bars
  console.log(boxRow(
    tokenBar(bTok, maxTok, barW, A.red),
    tokenBar(oTok, maxTok, barW, A.green),
  ));
  console.log(BOX_SEP);

  // Quality
  const qColor = oQ >= bQ ? A.green : A.yellow;
  console.log(boxRow(
    `${A.dim}Quality  ${A.reset}${A.bold}${bQ.toFixed(1)}${A.reset}${A.dim} / 10${A.reset}`,
    `${A.dim}Quality  ${A.reset}${A.bold}${qColor}${oQ.toFixed(1)}${A.reset}${A.dim} / 10${A.reset}`,
  ));

  // Growth curve section (spans full width)
  console.log(BOX_DIV);
  console.log(spanRow(`${A.dim}Token growth (${round} rounds):${A.reset}`));
  console.log(spanRow(`  ${A.red}baseline ${A.reset} ${sparkline(BASELINE_TOKENS,  i, A.red)}`));
  console.log(spanRow(`  ${A.green}optimized${A.reset} ${sparkline(OPTIMIZED_TOKENS, i, A.green)}`));
  console.log(BOX_BOT);

  // Cumulative summary below box
  if (saved > 0) {
    console.log(`\n  ${A.dim}Cumulative: ${A.reset}${A.red}${numFmt(bTotal)}${A.reset} baseline  vs  ${A.green}${numFmt(oTotal)}${A.reset} optimized  →  ${A.bold}${A.green}${numFmt(saved)} tokens saved (${savedPct}%)${A.reset}`);
  } else {
    console.log(`\n  ${A.dim}Sessions identical — compression kicks in as history grows...${A.reset}`);
  }
}

function renderFinal(): void {
  process.stdout.write(A.clear);

  console.log(`\n  ${A.bold}${A.cyan}Deja${A.reset}  ${A.dim}— 20-round benchmark  (real Claude Sonnet API)${A.reset}\n`);

  // Table geometry
  const W = { m: 26, b: 11, o: 11, d: 9 };
  const top = `  ┌${"─".repeat(W.m+2)}┬${"─".repeat(W.b+2)}┬${"─".repeat(W.o+2)}┬${"─".repeat(W.d+2)}┐`;
  const mid = `  ├${"─".repeat(W.m+2)}┼${"─".repeat(W.b+2)}┼${"─".repeat(W.o+2)}┼${"─".repeat(W.d+2)}┤`;
  const bot = `  └${"─".repeat(W.m+2)}┴${"─".repeat(W.b+2)}┴${"─".repeat(W.o+2)}┴${"─".repeat(W.d+2)}┘`;

  const row = (m: string, b: string, o: string, d: string, hi = false) => {
    const dc = hi ? A.bold + A.green : A.green;
    return `  │ ${pad(m,W.m)} │ ${A.red}${pad(b,W.b,"r")}${A.reset} │ ${A.green}${pad(o,W.o,"r")}${A.reset} │ ${dc}${pad(d,W.d,"r")}${A.reset} │`;
  };

  console.log(top);
  console.log(`  │ ${pad("Metric",W.m)} │ ${pad("Baseline",W.b,"r")} │ ${pad("Deja",W.o,"r")} │ ${pad("Δ",W.d,"r")} │`);
  console.log(mid);
  console.log(row("Total prompt tokens",  "213,721", "60,628",  "-71.6%", true));
  console.log(row("Final round tokens",   " 21,220", " 5,578",  "-73.7%", true));
  console.log(row("Avg response quality", "  7.4/10", " 8.2/10", "  +0.8"));
  console.log(row("Memory retention",     "  10/10",  " 10/10",  "    ✓ "));
  console.log(bot);

  console.log(`\n  ${A.bold}${A.green}71.6% fewer tokens. Better quality. Zero memory loss.${A.reset}`);
  console.log(`\n  ${A.dim}github.com/Deja922/Deja${A.reset}\n`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  process.stdout.write(A.hide);
  try {
    renderIntro();
    await sleep(INTRO_MS);

    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      renderFrame(r);
      await sleep(ROUND_MS);
    }

    renderFinal();
    await sleep(OUTRO_MS);
  } finally {
    process.stdout.write(A.show);
  }
})();
