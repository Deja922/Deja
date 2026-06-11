# Deja Public Beta Launch Guide (Lite)

Last updated: 2026-06-11
Target: launch now for technical public beta users

## 1) Positioning

- Product: local context-compression proxy for AI coding workflows
- Beta scope: coding scenarios first
- Charging: not enabled in current public beta
- Account/payment: backend-compatible design reserved for later rollout

## 2) Target Users

- Users with long Claude/Codex/Cursor coding sessions
- Users comfortable with CLI setup
- Users who can run simple diagnostics (`deja doctor`, `deja status`)

## 3) Official Install Path

1. `npm install -g deja-context`
2. `deja setup`
3. `deja service:install`
4. `deja tools:install all --port 9090`
5. `deja doctor --port 9090`

## 4) Key Rotation (must-have support flow)

When users rotate provider keys:

```bash
deja key:update --key NEW_API_KEY
```

This updates mirrored runtime configs and restarts installed service/daemon when needed.

## 5) Beta Messaging

Recommended user-facing statement:

> Deja public beta is currently free.  
> We prioritize stability and key-rotation reliability.  
> Account/payment capability is being prepared and will be introduced in a later update.

## 6) Ops Checklist (Launch Day)

1. Confirm `npm run build:all` passes.
2. Confirm `npm test` passes.
3. Confirm `deja --help` and `deja doctor` work on a clean machine.
4. Validate `tools:list` shows expected routing state.
5. Publish troubleshooting links (`FAQ.md`, `TROUBLESHOOTING.md`).

## 7) Rollback Plan

- User-side immediate fallback:
  - `deja bypass on` (passthrough mode)
  - `deja service:remove`
  - `deja uninstall`
- Ops-side:
  - pause release announcements
  - patch and republish next patch version
