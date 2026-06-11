# Deja IP Protection Runbook (P0)

Last updated: 2026-06-11

Goal: protect commercial value while continuing public beta distribution.

## 1) Immediate actions (today)

1. Set GitHub repository visibility to private.
2. Disable forking on the repository.
3. Keep npm package distribution active (`deja-context`), but publish minimal runtime files only.
4. Ensure license and repository policy are aligned to BUSL-1.1.
5. Rotate any API keys that were ever committed, then clean git history if needed.

## 2) Manual GitHub steps

In GitHub repository settings:

1. `Settings -> General -> Danger Zone -> Change repository visibility -> Make private`
2. `Settings -> General -> Features -> disable forking` (if available in your plan)
3. `Settings -> Access -> limit collaborators to core team`

Optional automation (PowerShell):

```powershell
$env:GITHUB_TOKEN="YOUR_TOKEN"
powershell -File scripts/set-github-visibility.ps1 -Owner Deja922 -Repo Deja -Visibility private -DisableForking
```

## 3) Distribution strategy

1. Public beta users install from npm.
2. Source repository remains private.
3. Release archives include only runtime files:
   - `dist/`
   - `config/`
   - `scripts/postinstall-check.cjs`
   - `LICENSE`
   - `README.md`

## 4) Guardrails in this repo

Run before release:

```bash
npm run guard:protect
```

The guard checks:

1. license is `BUSL-1.1`
2. package publish surface is minimal
3. prepublish pipeline includes protection checks
4. release workflow does not package full `scripts/` or `src/`

## 5) Next hardening (recommended)

1. Move license issuance, trial/account logic, and risk-control logic to private backend only.
2. Add watermark/telemetry for commercial redistribution detection.
3. Add legal pages:
   - Terms of Service
   - Privacy Policy
   - Commercial licensing page
