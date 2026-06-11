#!/usr/bin/env node
/**
 * Protection guardrails:
 * - Keep license intentionally restrictive (BUSL-1.1).
 * - Avoid publishing broad source/helper scripts to npm.
 * - Keep release archives minimal.
 */

const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error(`\n[protect] FAIL: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[protect] OK: ${msg}`);
}

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const licensePath = path.join(root, "LICENSE");
const releaseWorkflowPath = path.join(root, ".github", "workflows", "release.yml");

if (!fs.existsSync(pkgPath)) fail("package.json missing");
if (!fs.existsSync(licensePath)) fail("LICENSE missing");
if (!fs.existsSync(releaseWorkflowPath)) fail(".github/workflows/release.yml missing");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const files = Array.isArray(pkg.files) ? pkg.files : [];
const prepublish = String(pkg.scripts?.prepublishOnly ?? "");
const license = String(pkg.license ?? "");

if (license !== "BUSL-1.1") {
  fail(`package.json license must be BUSL-1.1 (current: ${license || "empty"})`);
}
ok("package.json license is BUSL-1.1");

if (files.includes("scripts/")) {
  fail("package.json files must not include broad scripts/ directory");
}
if (files.some((entry) => entry.startsWith("src/"))) {
  fail("package.json files must not publish src/ paths");
}
if (!files.includes("scripts/postinstall-check.cjs")) {
  fail("package.json files must include scripts/postinstall-check.cjs");
}
ok("package.json publish surface is minimal");

if (!prepublish.includes("guard:protect")) {
  fail("prepublishOnly must run guard:protect");
}
ok("prepublishOnly includes guard:protect");

const licenseText = fs.readFileSync(licensePath, "utf8");
if (!licenseText.includes("Business Source License 1.1")) {
  fail("LICENSE must clearly declare Business Source License 1.1");
}
if (!licenseText.includes("Additional Use Grant")) {
  fail("LICENSE should define Additional Use Grant");
}
ok("LICENSE text has BUSL markers");

const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, "utf8");
if (releaseWorkflow.includes("cp -r scripts")) {
  fail("release workflow must not copy entire scripts directory");
}
if (releaseWorkflow.includes("cp -r src")) {
  fail("release workflow must not copy src directory");
}
ok("release workflow packaging is minimal");

// Secret scan on common text source files.
const scanExt = new Set([".ts", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".sh", ".ps1"]);
const skipDirs = new Set([".git", "node_modules", "dist-electron"]);
const suspectPatterns = [
  /sk-[A-Za-z0-9]{20,}/g,          // common API key prefix
  /ghp_[A-Za-z0-9]{20,}/g,         // GitHub PAT classic
  /BEGIN [A-Z ]*PRIVATE KEY/g,     // private key blocks
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (!scanExt.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
}

const filesToScan = [];
walk(root, filesToScan);
const hits = [];

for (const file of filesToScan) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  // dist output is generated; scan source/docs/scripts/workflows only.
  if (!(rel.startsWith("src/") || rel.startsWith("scripts/") || rel.startsWith("docs/") || rel.startsWith(".github/") || rel === "README.md")) {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of suspectPatterns) {
    if (pattern.test(text)) {
      hits.push(rel);
      break;
    }
  }
}

if (hits.length > 0) {
  fail(`possible secret material found in: ${hits.join(", ")}`);
}
ok("no obvious secret patterns found in source/docs/scripts");

console.log("\n[protect] All protection guardrails passed.\n");
