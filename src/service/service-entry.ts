import { startProxy } from "../proxy/server.js";
import { writeManagedSettings, isManagedSettingsActive } from "../cli/managed-settings.js";
import type { RuntimeConfig } from "../proxy/config-types.js";
import { DEFAULT_CONFIG } from "../proxy/config-types.js";
import { checkAndUpdateInBackground } from "./updater.js";
import { getServiceReadCandidates, readFirstAvailableRuntimeConfig } from "@/config/deja-config-store.js";

process.env["DEJA_SERVICE_MODE"] = "1";

function loadConfig(): RuntimeConfig {
  const candidates = getServiceReadCandidates();
  const loaded = readFirstAvailableRuntimeConfig(candidates);
  if (loaded) {
    process.stderr.write(`[deja-service] Loaded config from ${loaded.path}\n`);
    return loaded.config;
  }
  process.stderr.write(
    `[deja-service] No readable config found in: ${candidates.join(", ")}. Using defaults.\n`,
  );
  return DEFAULT_CONFIG;
}

const config = loadConfig();
const port = config.port;

const writeResult = writeManagedSettings(port);
if (writeResult.ok) {
  process.stderr.write(`[deja-service] routing config written -> ${writeResult.path}\n`);
} else {
  process.stderr.write(`[deja-service] WARN: cannot write managed-settings: ${writeResult.error ?? "unknown"}\n`);
}

setInterval(() => {
  if (!isManagedSettingsActive()) {
    const result = writeManagedSettings(port);
    if (result.ok) {
      process.stderr.write("[deja-service] managed-settings re-written (was missing)\n");
    }
  }
}, 30_000);

startProxy({
  config,
  verbose: false,
});

setTimeout(() => {
  void checkAndUpdateInBackground();
}, 30_000);
