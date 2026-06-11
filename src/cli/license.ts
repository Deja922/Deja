// License key validation for Deja Context Engine.
// Keys are RSA-256 signed by the Deja license server.
// Verification is fully offline using the embedded public key.
//
// Key format: DEJA-{base64url(json_payload)}.{base64url(rsa_sha256_signature)}
// Payload fields: { v: 1, email: string, expiry: number (unix ms), tier: "pro" | "team" }

import { createVerify } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAguquYcxUNS3stTXq6MNm
OsgX3H9er2tzMG6lJSVLc19zjMAzmy8OzNA+AwGvkbRohGd95mdXwzs6GE/AT737
324HEQR0jzQPGAud36+NvXFRPc9SfdIu3dYRsjF6KIpsMaDw0b/FcJoBV6rfmpx/
ueHvIIhwWO3n36Nu/VGyZhoIy3NKBGEYTg44NV4sNe/2UcFF5OJ1SKlp3t4Otk83
H5KcTSCZPLHZX5ytd46ChwfNK7ZEhvUjaYjbVpLRTjmVdy9K/r7KRa4Q+XdvctTw
19i4O3VLeb49Um7Sh1xNulbryMo8U1HivR0OI7GFJJIWvKFx21Gkc8Rqjr7WGos9
dQIDAQAB
-----END PUBLIC KEY-----`;

export type LicenseTier = "pro" | "team";

export interface LicensePayload {
  v: 1;
  email: string;
  expiry: number;
  tier: LicenseTier;
}

export interface LicenseStatus {
  valid: boolean;
  tier?: LicenseTier;
  email?: string;
  expiry?: number;
  reason?: string;
}

const LICENSE_PATH = join(homedir(), ".deja", "license.json");

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

export function parseKey(raw: string): { payload: LicensePayload; signature: Buffer } | null {
  const stripped = raw.trim().replace(/^DEJA-/, "");
  const dot = stripped.lastIndexOf(".");
  if (dot < 1) return null;

  const payloadB64 = stripped.slice(0, dot);
  const sigB64 = stripped.slice(dot + 1);

  try {
    const payloadJson = b64urlDecode(payloadB64).toString("utf-8");
    const payload = JSON.parse(payloadJson) as LicensePayload;
    const signature = b64urlDecode(sigB64);
    if (payload.v !== 1 || !payload.email || !payload.expiry || !payload.tier) return null;
    return { payload, signature };
  } catch {
    return null;
  }
}

function verifySignature(raw: string, payload: LicensePayload, signature: Buffer): boolean {
  try {
    const stripped = raw.trim().replace(/^DEJA-/, "");
    const dot = stripped.lastIndexOf(".");
    const payloadPart = stripped.slice(0, dot);

    const verifier = createVerify("SHA256");
    verifier.update(payloadPart);
    return verifier.verify(PUBLIC_KEY_PEM, signature);
  } catch {
    return false;
  }
}

export function validateKey(raw: string): LicenseStatus {
  const parsed = parseKey(raw);
  if (!parsed) return { valid: false, reason: "invalid key format" };

  const { payload, signature } = parsed;

  if (Date.now() > payload.expiry) {
    return { valid: false, reason: "key expired", email: payload.email, expiry: payload.expiry };
  }

  if (!verifySignature(raw, payload, signature)) {
    return { valid: false, reason: "signature invalid" };
  }

  return {
    valid: true,
    tier: payload.tier,
    email: payload.email,
    expiry: payload.expiry,
  };
}

export function saveLicense(raw: string): void {
  const dir = dirname(LICENSE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LICENSE_PATH, JSON.stringify({ key: raw.trim() }, null, 2) + "\n", "utf-8");
}

export function loadLicense(): string | null {
  if (!existsSync(LICENSE_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(LICENSE_PATH, "utf-8")) as { key?: string };
    return data.key ?? null;
  } catch {
    return null;
  }
}

export function getLicenseStatus(): LicenseStatus {
  const key = loadLicense();
  if (!key) return { valid: false, reason: "no license key" };
  return validateKey(key);
}
