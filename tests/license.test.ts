import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { validateKey, saveLicense, loadLicense, getLicenseStatus } from "../src/cli/license.js";

// Long-lived test key (expires 2126), signed with the real private key
const VALID_TEST_KEY =
  "DEJA-eyJ2IjoxLCJlbWFpbCI6InRlc3RAZGVqYS5kZXYiLCJleHBpcnkiOjQ5MzQ2OTIyNTY1MTEsInRpZXIiOiJwcm8ifQ" +
  ".INiU2qUGZEyzU2CNTpvp0R9fMM6S3UmDb1P3gMtPPT5Ryexyk-Gqab_Rfk_mvfwAH0ksj8stAhT_9ofKJgfKkPUmX" +
  "eWvZ7B6iO2QJh5ZpVHa-mU2ghgOCDjnhz7UyFiAu2jZM2isi9zaRd6m4iq1S6IloZPycwVc8lNJ0EX2hHbOs30ZjfS" +
  "8e0K8jSXbcCLSY3mj_6kUomuR80avthyBzM0dJg2ot3mJvTlgFdHWZ6x7xEuCJQx2SGMa8AKMnc2-b-BY-viEmADIM" +
  "8Bob_FzWPHa7iUobxHAKMh8i1SzYXjSb_3gxG98d6alaD1XOwNJ4IQhSDtnD9AlVkx-T0ScAg";

// Manufacture an expired key: valid format + parse, but expiry in the past
function makeExpiredKey(): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, email: "old@test.dev", expiry: Date.now() - 1000, tier: "pro" })
  ).toString("base64url");
  const fakeSig = Buffer.alloc(256).toString("base64url");
  return `DEJA-${payload}.${fakeSig}`;
}

// ── backup/restore the real license file around each test ────────────────────
const LICENSE_PATH = join(homedir(), ".deja", "license.json");
let savedLicense: string | null = null;

beforeEach(() => {
  savedLicense = existsSync(LICENSE_PATH) ? readFileSync(LICENSE_PATH, "utf-8") : null;
  if (existsSync(LICENSE_PATH)) unlinkSync(LICENSE_PATH);
});

afterEach(() => {
  if (existsSync(LICENSE_PATH)) unlinkSync(LICENSE_PATH);
  if (savedLicense !== null) writeFileSync(LICENSE_PATH, savedLicense, "utf-8");
});

describe("validateKey", () => {
  test("success: valid signed key returns tier/email/expiry", () => {
    const status = validateKey(VALID_TEST_KEY);
    expect(status.valid).toBe(true);
    expect(status.tier).toBe("pro");
    expect(status.email).toBe("test@deja.dev");
    expect(status.expiry).toBeGreaterThan(Date.now());
  });

  test("failure: empty string → invalid key format", () => {
    const status = validateKey("");
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("invalid key format");
  });

  test("failure: expired key → key expired + preserves email/expiry", () => {
    const status = validateKey(makeExpiredKey());
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("key expired");
    expect(status.email).toBe("old@test.dev");
    expect(status.expiry).toBeDefined();
  });

  test("failure: valid format + future expiry but wrong signature → signature invalid", () => {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, email: "x@test.dev", expiry: Date.now() + 86400000, tier: "pro" })
    ).toString("base64url");
    const fakeSig = Buffer.alloc(256, 0xab).toString("base64url");
    const status = validateKey(`DEJA-${payload}.${fakeSig}`);
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("signature invalid");
  });
});

describe("saveLicense / getLicenseStatus round-trip", () => {
  test("saved valid key is returned by getLicenseStatus", () => {
    saveLicense(VALID_TEST_KEY);
    const loaded = loadLicense();
    expect(loaded).toBe(VALID_TEST_KEY);

    const status = getLicenseStatus();
    expect(status.valid).toBe(true);
    expect(status.tier).toBe("pro");
    expect(status.email).toBe("test@deja.dev");
  });

  test("no license file → valid=false, reason=no license key", () => {
    const status = getLicenseStatus();
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("no license key");
  });
});


describe("validateKey", () => {
  test("success: valid signed key returns tier/email/expiry", () => {
    const status = validateKey(VALID_TEST_KEY);
    expect(status.valid).toBe(true);
    expect(status.tier).toBe("pro");
    expect(status.email).toBe("test@deja.dev");
    expect(status.expiry).toBeGreaterThan(Date.now());
  });

  test("failure: empty string → invalid key format", () => {
    const status = validateKey("");
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("invalid key format");
  });

  test("failure: expired key → key expired + preserves email/expiry", () => {
    const status = validateKey(makeExpiredKey());
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("key expired");
    expect(status.email).toBe("old@test.dev");
    expect(status.expiry).toBeDefined();
  });

  test("failure: valid format + future expiry but wrong signature → signature invalid", () => {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, email: "x@test.dev", expiry: Date.now() + 86400000, tier: "pro" })
    ).toString("base64url");
    const fakeSig = Buffer.alloc(256, 0xab).toString("base64url");
    const status = validateKey(`DEJA-${payload}.${fakeSig}`);
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("signature invalid");
  });
});

describe("saveLicense / getLicenseStatus round-trip", () => {
  test("saved valid key is returned by getLicenseStatus", () => {
    saveLicense(VALID_TEST_KEY);
    const loaded = loadLicense();
    expect(loaded).toBe(VALID_TEST_KEY);

    const status = getLicenseStatus();
    expect(status.valid).toBe(true);
    expect(status.tier).toBe("pro");
    expect(status.email).toBe("test@deja.dev");
  });

  test("no license file → FREE / no license key", () => {
    const status = getLicenseStatus();
    expect(status.valid).toBe(false);
    expect(status.reason).toBe("no license key");
  });
});
