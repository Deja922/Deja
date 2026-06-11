#!/usr/bin/env node
// Generate RSA-2048 key pair for Deja license signing.
// Private key → ~/.deja/keys/private.pem (NEVER commit this file)
// Public key  → ~/.deja/keys/public.pem  (copy into src/cli/license.ts)
//
// Usage: node scripts/gen-keys.mjs

import { generateKeyPairSync } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const KEYS_DIR = join(homedir(), ".deja", "keys");
const PRIVATE_KEY_PATH = join(KEYS_DIR, "private.pem");
const PUBLIC_KEY_PATH = join(KEYS_DIR, "public.pem");

if (existsSync(PRIVATE_KEY_PATH)) {
  console.error(`ERROR: private key already exists at ${PRIVATE_KEY_PATH}`);
  console.error("Delete it manually if you really want to regenerate.");
  process.exit(1);
}

mkdirSync(KEYS_DIR, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
writeFileSync(PUBLIC_KEY_PATH, publicKey);

console.log("Keys generated:");
console.log(`  Private: ${PRIVATE_KEY_PATH}  ← keep secret, never commit`);
console.log(`  Public:  ${PUBLIC_KEY_PATH}`);
console.log();
console.log("Copy the following into src/cli/license.ts (PUBLIC_KEY_PEM):");
console.log();
console.log(publicKey);
