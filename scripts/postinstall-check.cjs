/**
 * CJS entry point for the npm postinstall hook.
 * Checks if dist/ has been built before trying to run the compiled postinstall script.
 * This way `npm install` in the source repo (where dist/ may not exist) is always silent.
 */
const { existsSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

const pkgRoot = join(__dirname, "..");
const postinstallScript = join(pkgRoot, "dist", "cli", "postinstall.js");

if (existsSync(postinstallScript)) {
  const result = spawnSync(process.execPath, [postinstallScript], {
    stdio: "inherit",
    cwd: pkgRoot,
  });
  // Always exit 0 — never fail the install
  process.exit(0);
}
// dist not built yet (dev install) — skip silently
