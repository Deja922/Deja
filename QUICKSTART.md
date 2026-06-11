# Deja Quickstart (Public Beta)

Deja is a local proxy that compresses long AI coding conversations before they reach your upstream API.

## 1) Prerequisites

- Node.js `18+`
- An API key from your upstream provider
- One of these tools: Claude Code, Codex, Cursor, Continue

Check Node:

```bash
node --version
```

## 2) Install CLI

```bash
npm install -g deja-context
deja --version
```

## 3) First-time setup

Use guided setup:

```bash
deja setup
```

Or provide key directly:

```bash
deja setup --key YOUR_API_KEY --port 9090
```

## 4) Install background service

Windows (run terminal as Administrator):

```bash
deja service:install
```

macOS:

```bash
deja service:install
```

Linux (current beta recommendation):

```bash
deja start --daemon --port 9090
```

## 5) Route your tools through Deja

```bash
deja tools:install all --port 9090
deja tools:list --port 9090
```

`all` includes Cursor, Continue, and Codex routing helpers. Claude Code routing is handled by managed settings/service path.

## 6) Verify health

```bash
deja doctor --port 9090
deja status --port 9090
```

Optional dashboard:

```bash
deja dashboard --port 9090
```

## 7) Rotate API key safely

Use this whenever users change provider keys:

```bash
deja key:update --key NEW_API_KEY
```

Optional overrides:

```bash
deja key:update --key NEW_API_KEY --provider anthropic --upstream https://api.anthropic.com
```

The command updates mirrored runtime configs and restarts installed service/daemon when needed.

## 8) License flows

Activate a direct license key:

```bash
deja license:activate DEJA-XXXX-XXXX-XXXX
```

Redeem a trial/purchase code:

```bash
deja license:redeem CODE-XXXX
```

Check current status:

```bash
deja license:status
```

## 9) Useful commands

```bash
deja start --port 9090
deja stop
deja logs --tail 100
deja logs --follow
deja bypass on
deja bypass off
```

## 10) Uninstall

```bash
deja service:remove
deja uninstall
```

## Troubleshooting

- `deja doctor` for automatic diagnostics
- See `FAQ.md`
- See `TROUBLESHOOTING.md`
