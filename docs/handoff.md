# Deja Handoff (Session Bootstrap)

Last updated: 2026-06-11 (session 7)

## 1) Session goal
- Push Deja to launch-ready public beta before June 12.
- Keep key rotation, routing, and multi-tool integration stable (Claude/Codex/Cursor).
- Minimize user-side manual steps.

## 2) Today completed (2026-06-11)

### A. Key rotation reliability (core fix)
- Added `deja key:update` command:
  - updates provider key/upstream
  - writes runtime config to all mirrors
  - restarts installed service/daemon automatically
- Files:
  - `src/cli/commands/key-update.ts` (new)
  - `src/cli/deja.ts` (new command wiring)

### B. Unified runtime config behavior
- Service entry now loads config from deterministic candidate paths (`DEJA_CONFIG_PATH` aware).
- Windows service now:
  - seeds ProgramData config
  - sets `DEJA_CONFIG_PATH`
  - supports service detection/restart helpers
- macOS daemon now:
  - uses `DEJA_CONFIG_PATH` (no API key hardcoded into plist env)
  - supports daemon detection/restart helpers
- Files:
  - `src/service/service-entry.ts`
  - `src/service/windows-service.ts`
  - `src/service/macos-daemon.ts`
  - `src/config/deja-config-store.ts`

### C. Doctor + Start consistency
- `doctor` now checks:
  - runtime config mirror drift
  - Windows ProgramData config presence when service is installed
  - actionable fix command (`deja key:update --key ...`)
- `start` now reads config via candidate strategy instead of only `~/.deja/config.json`.
- Files:
  - `src/cli/commands/doctor.ts`
  - `src/cli/commands/start.ts`

### D. Multi-tool integration expanded
- Rebuilt `tools` command implementation.
- Added Codex integration (`tools:list`, `tools:install codex`, `tools:install all`).
- Cursor path handling improved (settings.json based).
- Files:
  - `src/cli/commands/tools.ts` (new/replaced)
  - `src/cli/deja.ts` (tool command descriptions updated)

### E. Verification done
- `npm run build` passed.
- `npm test` passed (`89/89`).
- Real smoke test passed:
  - `deja key:update --key ...`
  - mirror files all updated
  - Windows service restarted successfully
  - `deja doctor` shows mirrors in sync and ProgramData config present.

## 3) Current product status (for launch decision)
- Technical beta is ready for targeted public testing.
- Core value path works:
  - install -> service -> routing -> key rotation -> diagnostics
- Current recommended positioning:
  - targeted beta for technical users first
  - not yet broad non-technical mass release until docs/installer text polish is finished.

## 4) Business decision snapshot
- Trial model proposed: `24h full trial -> low-price monthly`.
- Required anti-abuse baseline:
  - light account (phone/email OTP)
  - one-time trial bound to account + device fingerprint
  - periodic license heartbeat.
- Recommendation: keep GitHub private (or split open-core/private-commercial) before paid launch hardening.

## 5) P0 before June 12 launch
1. Fix installer/docs encoding/wording consistency (some Chinese text is garbled).
2. Lock one official install path for Windows/macOS docs.
3. Ship payment MVP (WeChat + Alipay) with webhook-based license issuance.
4. Finalize account/trial state machine (trial/active/expired/revoked).
5. Publish launch FAQ: key rotation, doctor self-recovery, common connection errors.

## 6) Immediate next task (tomorrow)
- Implement billing/account MVP spec (data model + API + webhook flow) and wire CLI activation UX.

## 7) Session 7 update (same day)

### Completed

1. Added CLI redeem flow:
   - New command: `deja license:redeem <code>`
   - Endpoint override support (`--endpoint`)
   - Optional account verification fields (`--email`, `--phone`)
   - Optional explicit device ID (`--device-id`)
   - Local license validation + save after redeem
   - File: `src/cli/commands/license-redeem.ts` (new)
   - File: `src/cli/deja.ts` (command wiring)

2. Added launch-ready billing/account technical spec:
   - Data model
   - API contract
   - webhook flow
   - trial + paid state machine
   - WeChat/Alipay integration strategy
   - File: `docs/billing-account-mvp.md` (new)

### Verification

1. `npm run build` passed.
2. `npm test` passed (`89/89`).
3. `deja help license:redeem` works.

## 8) Session 8 update (launch hardening)

### Completed

1. Fixed user-facing CLI mojibake in license activation output.
   - `src/cli/deja.ts`
   - Replaced garbled labels with readable fields: `Tier`, `Email`, `Expiry`
   - Normalized CLI description text to ASCII-safe formatting

2. Rewrote quickstart document for public beta onboarding.
   - `QUICKSTART.md`
   - Added clean install/setup/service/routing/doctor/key-rotation/license flows
   - Included commands for `tools:install all`, `key:update`, `license:activate`, and `license:redeem`

3. Rewrote macOS/Linux installer script to remove encoding corruption and restore reliability.
   - `installer/install.sh`
   - Added robust argument parsing, dependency checks, GitHub release asset resolution, config generation, service startup, and health check
   - Kept install behavior aligned with current CLI (`service:install` on macOS, daemon on Linux)

### Verification

1. `npm run build` passed.
2. `npm test` passed (`89/89`).
3. `node dist/cli/deja.js --help` passed.
4. `node dist/cli/deja.js help license:redeem` passed.
5. `node dist/cli/deja.js tools:list --port 9090` passed.

## 9) Session 9 update (public beta publish)

### Product decision executed

1. Public beta remains free for now (no paid gating enabled).
2. Account/payment architecture stays prepared for future activation.

### Code and doc updates

1. Published package version bump:
   - `package.json` version updated to `0.1.1`
   - CLI/proxy visible versions synced to `0.1.1`

2. Public beta free policy applied in runtime:
   - `src/cli/usage.ts`
   - Added `BETA_FREE_UNLIMITED` (default on)
   - FREE tier no longer monthly-blocked during beta unless `DEJA_BETA_FREE_UNLIMITED=0`

3. Launch-facing documentation cleaned for release:
   - `README.md` rewritten for current public beta status
   - `docs/beta-launch-lite.md` rewritten
   - `docs/release-gate-lite.md` rewritten
   - `docs/billing-account-mvp.md` updated with free-beta rollout note

4. CLI/user-facing text cleanup:
   - startup/license wording aligned to current beta policy
   - version strings and key help paths validated

### Verification and release result

1. `npm run build:all` passed.
2. `npm test` passed (`89/89`).
3. `npm pack --dry-run` passed.
4. `npm publish --dry-run` passed.
5. `npm publish` succeeded.
6. Registry check: `npm view deja-context version` -> `0.1.1`.

## 10) Session 10 update (IP protection hardening)

### Completed

1. Added protection guardrails in release pipeline:
   - `scripts/assert-protection-guardrails.cjs`
   - `npm run guard:protect`
   - `prepublishOnly` now requires guard check before build/test

2. Minimized npm publish surface:
   - `package.json` `files` now excludes broad `scripts/` and all `src/`
   - Keeps only `scripts/postinstall-check.cjs` as required runtime helper

3. Minimized GitHub release archive surface:
   - `.github/workflows/release.yml` no longer copies full `scripts/` or `src/`
   - Includes only runtime assets (`dist`, `config`, `LICENSE`, `README`, postinstall helper)

4. License policy hardened:
   - `LICENSE` rewritten to clear BUSL-1.1 terms with explicit Additional Use Grant
   - README now includes explicit commercial-use restriction note

5. Added operational runbook + automation helper:
   - `docs/ip-protection-runbook.md`
   - `scripts/set-github-visibility.ps1` (token-based visibility switch + optional disable-forking)

### Verification

1. `npm run guard:protect` passed.
2. `npm run build` passed.
3. `npm test` passed (`89/89`).
4. `npm pack --dry-run` confirms reduced publish contents.

## 11) Session 11 update (history purge for leaked key)

### Completed

1. Performed sensitive-data history rewrite in a mirror clone using `git-filter-repo`.
   - Replaced leaked literal key:
     - `sk-REDACTED-REMOVED`
   - Rewrite summary:
     - rewritten commits: `2 / 12`
     - first changed commit: `945f2b1d0f49e4b8f4ff7cbf79b8bf821eae4bdc`

2. Force-pushed rewritten history to remote:
   - old main: `1de0a4c...`
   - new main: `5495fca...`

3. Verified post-push in a fresh remote mirror:
   - full-history grep for leaked key: `REMOTE_NO_MATCH`

### Remaining mandatory actions

1. Switch repository to private and disable forking.
2. Rotate the leaked upstream API key at provider side immediately.
3. Ensure all collaborators reclone or hard-sync to rewritten history before further pushes.
