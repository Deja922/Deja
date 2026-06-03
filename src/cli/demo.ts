#!/usr/bin/env node
// Deja — 60-second terminal demo
// Uses ASCII-only borders (no Unicode box-drawing) for reliable GIF rendering.

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

// ── Timing (total ~60s) ───────────────────────────────────────────────────────
const INTRO_MS     = 5000;
const ROUND_MS     = 2500;   // 20 x 2500 = 50 000 ms
const OUTRO_MS     = 5000;
const TOTAL_ROUNDS = 20;

// ── ANSI colours ─────────────────────────────────────────────────────────────
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

// Strip ANSI codes to measure visible length
function vlen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// Pad to visible width (handles strings with ANSI colour codes)
function pad(s: string, w: number, align: "l"|"r" = "l"): string {
  const spaces = " ".repeat(Math.max(0, w - vlen(s)));
  return align === "r" ? spaces + s : s + spaces;
}

// ── Layout constants (ASCII borders only) ─────────────────────────────────────
const COLW = 36;   // visible chars per column
// Row: "| " + COLW + " | " + COLW + " |"  = COLW*2 + 7 total

const SEP   = "+" + "-".repeat(COLW + 2) + "+" + "-".repeat(COLW + 2) + "+";
const FULL  = "+" + "-".repeat(COLW * 2 + 5) + "+";
const BLANK = "| " + " ".repeat(COLW) + " | " + " ".repeat(COLW) + " |";

function row(left: string, right: string): string {
  return "| " + pad(left, COLW) + " | " + pad(right, COLW) + " |";
}

function span(content: string): string {
  return "| " + pad(content, COLW * 2 + 3) + " |";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function numFmt(n: number): string { return n.toLocaleString(); }

function tokenBar(val: number, max: number, w: number, color: string): string {
  const filled = Math.round((val / max) * w);
  return color + "█".repeat(filled) + A.dim + "░".repeat(w - filled) + A.reset;
}

function savingsBadge(base: number, opt: number): string {
  if (base === opt) return A.dim + "     --" + A.reset;
  const p = ((base - opt) / base) * 100;
  return p > 0
    ? A.bold + A.green + "-" + p.toFixed(1) + "%" + A.reset
    : A.red  + "+" + Math.abs(p).toFixed(1) + "%" + A.reset;
}

function sparkline(data: number[], upTo: number, color: string): string {
  const max = Math.max(...BASELINE_TOKENS);
  const bars = ["_",".","-","=","~","#","$","@"];
  // Use simple ASCII chars for sparkline to avoid width issues
  return data.slice(0, upTo + 1).map(v => {
    const h = Math.max(0, Math.round((v / max) * (bars.length - 1)));
    return color + bars[h];
  }).join("") + A.reset;
}

// ── Screens ───────────────────────────────────────────────────────────────────

function renderIntro(): void {
  process.stdout.write(A.clear);
  console.log("");
  console.log("  " + A.bold + A.cyan + "Deja" + A.reset + "  " + A.dim + "-- context compression for AI coding sessions" + A.reset);
  console.log("");
  console.log("  " + A.dim + "What happens to your Claude Code session after 20 rounds?" + A.reset);
  console.log("");
  console.log("  " + A.red  + "Without Deja:" + A.reset + "  round 1 ->   " + A.bold + "108" + A.reset + " tokens    round 20 -> " + A.bold + A.red + "21,220" + A.reset + " tokens");
  console.log("  " + A.green + "With Deja:   " + A.reset + "  round 1 ->   " + A.bold + "108" + A.reset + " tokens    round 20 -> " + A.bold + A.green + " 5,578" + A.reset + " tokens");
  console.log("");
  console.log("  " + A.dim + "Starting live comparison -- 20 rounds..." + A.reset);
  console.log("");
}

function renderFrame(round: number): void {
  const i      = round - 1;
  const bTok   = BASELINE_TOKENS[i];
  const oTok   = OPTIMIZED_TOKENS[i];
  const bQ     = BASELINE_QUALITY[i];
  const oQ     = OPTIMIZED_QUALITY[i];
  const isCkpt = CHECKPOINTS.has(round);
  const maxTok = 22000;
  const barW   = 19;

  const bTotal = BASELINE_TOKENS.slice(0,round).reduce((a,b)=>a+b,0);
  const oTotal = OPTIMIZED_TOKENS.slice(0,round).reduce((a,b)=>a+b,0);
  const saved  = bTotal - oTotal;
  const savedPct = bTotal > 0 ? ((saved/bTotal)*100).toFixed(1) : "0.0";

  process.stdout.write(A.clear);

  console.log("  " + A.bold + A.cyan + "Deja" + A.reset + A.dim + " -- Live Session Comparison" + A.reset);
  console.log("  " + SEP);
  console.log("  " + row(
    A.bold + A.red   + " X  WITHOUT Deja" + A.reset,
    A.bold + A.green + " O  WITH Deja"    + A.reset,
  ));
  console.log("  " + SEP);

  const ckpt = isCkpt ? "  " + A.yellow + "* checkpoint" + A.reset : "";
  console.log("  " + row(
    A.dim + "Round " + A.reset + A.bold + round + A.reset + A.dim + " / " + TOTAL_ROUNDS + A.reset + ckpt,
    A.dim + "Round " + A.reset + A.bold + round + A.reset + A.dim + " / " + TOTAL_ROUNDS + A.reset + ckpt,
  ));
  console.log("  " + row(
    A.dim + "Topic: " + A.reset + TOPICS[i],
    A.dim + "Topic: " + A.reset + TOPICS[i],
  ));
  console.log("  " + BLANK);

  const badge = savingsBadge(bTok, oTok);
  console.log("  " + row(
    A.bold + A.red   + pad(numFmt(bTok), 8, "r") + " tokens" + A.reset,
    A.bold + A.green + pad(numFmt(oTok), 8, "r") + " tokens" + A.reset + "  " + badge,
  ));
  console.log("  " + BLANK);
  console.log("  " + row(
    tokenBar(bTok, maxTok, barW, A.red),
    tokenBar(oTok, maxTok, barW, A.green),
  ));
  console.log("  " + BLANK);
  console.log("  " + row(
    A.dim + "Quality  " + A.reset + A.bold + bQ.toFixed(1) + A.reset + A.dim + " / 10" + A.reset,
    A.dim + "Quality  " + A.reset + A.bold + (oQ >= bQ ? A.green : A.yellow) + oQ.toFixed(1) + A.reset + A.dim + " / 10" + A.reset,
  ));

  // Full-width growth section
  console.log("  " + FULL);
  console.log("  " + span(A.dim + "Token growth (" + round + " rounds):" + A.reset));
  console.log("  " + span("  " + A.red   + "baseline  " + A.reset + " " + sparkline(BASELINE_TOKENS,  i, A.red)));
  console.log("  " + span("  " + A.green + "optimized " + A.reset + " " + sparkline(OPTIMIZED_TOKENS, i, A.green)));
  console.log("  " + FULL);
  console.log("");

  if (saved > 0) {
    console.log("  " + A.dim + "Cumulative: " + A.reset
      + A.red + numFmt(bTotal) + A.reset + " baseline  vs  "
      + A.green + numFmt(oTotal) + A.reset + " optimized  -->  "
      + A.bold + A.green + numFmt(saved) + " tokens saved (" + savedPct + "%)" + A.reset);
  } else {
    console.log("  " + A.dim + "Sessions identical -- compression kicks in as history grows..." + A.reset);
  }
}

function renderFinal(): void {
  process.stdout.write(A.clear);

  console.log("");
  console.log("  " + A.bold + A.cyan + "Deja" + A.reset + "  " + A.dim + "-- 20-round benchmark  (real Claude Sonnet API, no mocking)" + A.reset);
  console.log("");

  const W = { m: 26, b: 10, o: 10, d: 8 };
  const top = "  +" + "-".repeat(W.m+2) + "+" + "-".repeat(W.b+2) + "+" + "-".repeat(W.o+2) + "+" + "-".repeat(W.d+2) + "+";
  const mid = "  +" + "-".repeat(W.m+2) + "+" + "-".repeat(W.b+2) + "+" + "-".repeat(W.o+2) + "+" + "-".repeat(W.d+2) + "+";

  const trow = (m: string, b: string, o: string, d: string, hi = false) => {
    const dc = hi ? A.bold + A.green : A.green;
    return "  | " + pad(m,W.m) + " | " + A.red   + pad(b,W.b,"r") + A.reset
                                + " | " + A.green + pad(o,W.o,"r") + A.reset
                                + " | " + dc      + pad(d,W.d,"r") + A.reset + " |";
  };

  console.log(top);
  console.log("  | " + pad("Metric",W.m) + " | " + pad("Baseline",W.b,"r") + " | " + pad("Deja",W.o,"r") + " | " + pad("Delta",W.d,"r") + " |");
  console.log(mid);
  console.log(trow("Total prompt tokens",  "213,721", "60,628",  "-71.6%", true));
  console.log(trow("Final round tokens",   " 21,220", " 5,578",  "-73.7%", true));
  console.log(trow("Avg response quality", "  7.4/10", " 8.2/10", "  +0.8"));
  console.log(trow("Memory retention",     "  10/10",  " 10/10",  "  100%"));
  console.log(top);

  console.log("");
  console.log("  " + A.bold + A.green + "71.6% fewer tokens. Better quality. Zero memory loss." + A.reset);
  console.log("");
  console.log("  " + A.dim + "github.com/Deja922/Deja" + A.reset);
  console.log("");
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
