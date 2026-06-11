import { createHash } from "crypto";
import { homedir, hostname, platform } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { saveLicense, validateKey } from "../license.js";

export interface LicenseRedeemOptions {
  endpoint?: string;
  email?: string;
  phone?: string;
  deviceId?: string;
  timeoutMs?: number;
}

interface RedeemResponse {
  licenseKey?: string;
  message?: string;
  code?: string;
}

function resolveEndpoint(override?: string): string {
  return (
    override?.trim() ||
    process.env["DEJA_LICENSE_REDEEM_ENDPOINT"] ||
    "https://license.deja.run/v1/licenses/redeem"
  );
}

function stableDeviceId(): string {
  if (process.env["DEJA_DEVICE_ID"]?.trim()) {
    return process.env["DEJA_DEVICE_ID"]!.trim();
  }
  const home = homedir();
  const machineHints = [
    platform(),
    hostname(),
    process.env["USERNAME"] ?? "",
    process.env["USER"] ?? "",
    home,
  ].join("|");

  const legacyPath = join(home, ".deja", "device-id");
  if (existsSync(legacyPath)) {
    try {
      const persisted = readFileSync(legacyPath, "utf-8").trim();
      if (persisted) return persisted;
    } catch {
      // ignore and fall back to hash
    }
  }

  return `deja_${createHash("sha256").update(machineHints).digest("hex").slice(0, 24)}`;
}

export async function redeemLicense(code: string, opts: LicenseRedeemOptions): Promise<void> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Redeem code is empty.");
  }

  const endpoint = resolveEndpoint(opts.endpoint);
  const timeoutMs = opts.timeoutMs ?? 12000;
  const deviceId = opts.deviceId?.trim() || stableDeviceId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: normalizedCode,
        deviceId,
        ...(opts.email?.trim() ? { email: opts.email.trim() } : {}),
        ...(opts.phone?.trim() ? { phone: opts.phone.trim() } : {}),
        client: {
          name: "deja-cli",
          platform: process.platform,
          node: process.version,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Cannot reach redeem endpoint: ${(err as Error).message}`);
  }
  clearTimeout(timer);

  let payload: RedeemResponse = {};
  try {
    payload = (await response.json()) as RedeemResponse;
  } catch {
    // ignore json decode issues; response status will still be used below
  }

  if (!response.ok) {
    const details = payload.message ?? payload.code ?? `${response.status} ${response.statusText}`;
    throw new Error(`Redeem failed: ${details}`);
  }

  if (!payload.licenseKey?.trim()) {
    throw new Error("Redeem endpoint did not return a licenseKey.");
  }

  const licenseKey = payload.licenseKey.trim();
  const status = validateKey(licenseKey);
  if (!status.valid) {
    throw new Error(`Server returned invalid license key: ${status.reason ?? "unknown"}`);
  }

  saveLicense(licenseKey);

  console.log("  OK  License redeemed and activated");
  console.log(`     Tier   : ${(status.tier ?? "").toUpperCase()}`);
  if (status.email) console.log(`     Email  : ${status.email}`);
  if (status.expiry) console.log(`     Expiry : ${new Date(status.expiry).toLocaleDateString("zh-CN")}`);
  console.log("     Note   : If Deja is already running, restart service to apply immediately.");
}
