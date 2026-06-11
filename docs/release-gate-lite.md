# Deja Release Gate (Lite)

Last updated: 2026-06-11

This gate is for public beta launch of coding-focused usage.

## Required Metrics

| Metric | Target | Status rule |
|---|---|---|
| Build success | pass | must pass |
| Test suite | all green | must pass |
| Core CLI health | `deja --help`, `deja doctor` | must pass |
| Key rotation | `deja key:update` writes mirrors and restarts service if installed | must pass |
| Tool routing | Claude/Codex/Cursor/Continue path available via `tools:list` and `tools:install` | must pass |

## Recommended (not hard blockers for Lite)

| Metric | Target |
|---|---|
| Token savings | >= 25% in representative long sessions |
| Added latency overhead | <= 800ms median delta |
| Auto-bypass behavior | no uncontrolled loops; fallback works |

## Release Decision

Release allowed when all required metrics pass and no P0 regression exists.

## Free Beta Policy

- Charging is disabled in current beta release.
- Account/payment interfaces remain prepared for future activation.
- Free users are not blocked by monthly compression limit during beta by default.
