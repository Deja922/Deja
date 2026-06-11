# Deja Context Engine

Deja is a local proxy that keeps long AI coding sessions stable by compressing repetitive context before requests reach upstream APIs.

## Public Beta Status

- Release channel: public beta
- Pricing (current beta): free
- Free beta policy: full features enabled for free users during beta
- Target tools: Claude Code, Codex, Cursor, Continue
- Supported OS: Windows now; macOS path included in installer/daemon flow

## What Deja Solves

- Reduces repeated history tokens in long sessions
- Helps keep response quality stable over long coding loops
- Cuts token usage through dedup + selective compression
- Provides safe bypass controls when compression should be paused

## Quick Start

Install:

```bash
npm install -g deja-context
```

Setup:

```bash
deja setup
```

Install service/daemon:

```bash
deja service:install
```

Route tools:

```bash
deja tools:install all --port 9090
deja tools:list --port 9090
```

Health check:

```bash
deja doctor --port 9090
deja status --port 9090
```

Rotate key safely:

```bash
deja key:update --key NEW_API_KEY
```

## License and Account Readiness

Current beta keeps usage free, but account/payment compatibility is prepared:

- Local signed license verification
- Redeem flow command: `deja license:redeem <code>`
- Activation command: `deja license:activate <key>`
- Billing/account MVP spec: `docs/billing-account-mvp.md`

## Useful Commands

```bash
deja start --port 9090
deja stop
deja logs --tail 100
deja logs --follow
deja bypass on
deja bypass off
deja dashboard --port 9090
```

## Build and Test

```bash
npm run typecheck
npm run build:all
npm test
```

## Troubleshooting

- `FAQ.md`
- `TROUBLESHOOTING.md`
- `docs/handoff.md` for latest implementation status

## License

BUSL-1.1. See `LICENSE`.

Commercial use of Deja (including resale/hosted redistribution or commercial derivative products)
requires a separate commercial license from the Licensor.
