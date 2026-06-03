/**
 * Generates an asciinema v2 cast file by running the demo script
 * and capturing its output with timestamps, then converts to GIF via agg.
 *
 * asciinema is Linux-only; this script reimplements the cast format directly.
 */

import { spawn } from "child_process";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";

const CAST_FILE = "demo.cast";
const GIF_FILE = "demo.gif";
const WIDTH = 120;
const HEIGHT = 36;

interface CastEvent {
  time: number;
  type: "o";
  data: string;
}

async function generateCast(): Promise<void> {
  console.log("Recording demo output...");

  const events: CastEvent[] = [];
  const startTime = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "src/cli/demo.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          TERM: "xterm-256color",
          COLUMNS: String(WIDTH),
          LINES: String(HEIGHT),
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      }
    );

    const capture = (data: Buffer) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const chunk = data.toString("utf8");
      // Split into individual writes for better timing granularity
      if (chunk.length > 0) {
        events.push({ time: elapsed, type: "o", data: chunk });
      }
    };

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    child.on("close", (code) => {
      if (code === 0 || events.length > 10) resolve();
      else reject(new Error(`Demo exited with code ${code}`));
    });

    child.on("error", reject);

    // Safety timeout — demo runs ~45s
    setTimeout(() => resolve(), 55_000);
  });

  console.log(`Captured ${events.length} events over ${events[events.length - 1]?.time.toFixed(1)}s`);

  // Write asciinema v2 cast file
  const header = {
    version: 2,
    width: WIDTH,
    height: HEIGHT,
    timestamp: Math.floor(Date.now() / 1000),
    title: "Deja — context compression for AI coding sessions",
    env: { TERM: "xterm-256color", SHELL: "/bin/bash" },
  };

  const lines = [
    JSON.stringify(header),
    ...events.map((e) => JSON.stringify([e.time, e.type, e.data])),
  ];

  writeFileSync(CAST_FILE, lines.join("\n") + "\n");
  console.log(`Saved ${CAST_FILE} (${(lines.join("\n").length / 1024).toFixed(1)} KB)`);
}

async function convertToGif(): Promise<void> {
  const aggBin = existsSync("./agg.exe") ? "./agg.exe" : "agg";
  console.log(`Converting ${CAST_FILE} → ${GIF_FILE} via agg...`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      aggBin,
      [
        CAST_FILE,
        GIF_FILE,
        "--theme", "monokai",
        "--font-size", "14",
        "--cols", String(WIDTH),
        "--rows", String(HEIGHT),
        "--speed", "1.0",
        "--idle-time-limit", "2",
      ],
      { stdio: "inherit" }
    );

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`agg exited with code ${code}`));
    });
    child.on("error", reject);
  });

  const size = require("fs").statSync(GIF_FILE).size;
  console.log(`\nCreated ${GIF_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

(async () => {
  await generateCast();
  await convertToGif();
  console.log("\nDone! Commit demo.gif and push to GitHub.");
})();
