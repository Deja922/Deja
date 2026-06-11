#!/usr/bin/env bash

set -euo pipefail

INSTALL_DIR="$HOME/.deja/app"
CONFIG_DIR="$HOME/.deja"
KEEP_CONFIG=0

for arg in "$@"; do
  case "$arg" in
    --keep-config) KEEP_CONFIG=1 ;;
    -h|--help)
      echo "Usage: uninstall.sh [--keep-config]"
      echo "  --keep-config   Remove the service but keep ~/.deja/config.json"
      exit 0
      ;;
  esac
done

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux"  ;;
  *) echo "ERROR: unsupported OS: $OS" >&2; exit 1 ;;
esac

info()  { echo "  $*"; }
ok()    { echo "  ✓  $*"; }
skip()  { echo "  -  $*"; }

echo
echo "  Deja Context Engine - Uninstall"
echo "  ================================"
echo

# ── Step 1: stop & remove service ────────────────────────────────────────────
info "[1/4] Stopping service..."

DEJA_BIN="$INSTALL_DIR/dist/cli/deja.js"

if [[ "$PLATFORM" == "darwin" ]]; then
  LABEL="com.deja.context-engine"
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  UID_VAL="$(id -u)"

  if [[ -f "$PLIST" ]]; then
    # Unload (ignore errors if not loaded)
    launchctl bootout "gui/${UID_VAL}" "$PLIST" 2>/dev/null || \
      launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    ok "LaunchAgent removed"
  else
    skip "LaunchAgent not installed"
  fi

  # Also call CLI to clean up managed-settings if app is present
  if [[ -f "$DEJA_BIN" ]]; then
    node "$DEJA_BIN" service:remove 2>/dev/null || true
  fi

else
  # Linux: kill daemon by PID file
  PID_FILE="$CONFIG_DIR/deja.pid"
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PID_FILE"
    ok "Daemon stopped"
  else
    # Try killing by process name as fallback
    pkill -f "deja.js" 2>/dev/null || true
    skip "PID file not found, killed by name if running"
  fi

  if [[ -f "$DEJA_BIN" ]]; then
    node "$DEJA_BIN" service:remove 2>/dev/null || true
  fi
fi

# ── Step 2: kill Electron tray window ────────────────────────────────────────
info "[2/4] Closing tray window..."
pkill -f "Deja Tray" 2>/dev/null || true
pkill -f "deja-tray" 2>/dev/null || true
ok "Tray window closed (if it was running)"

# ── Step 3: remove managed-settings.json ─────────────────────────────────────
info "[3/4] Removing routing config..."

if [[ "$PLATFORM" == "darwin" ]]; then
  MANAGED="$HOME/Library/Application Support/ClaudeCode/managed-settings.json"
else
  MANAGED="$HOME/.config/claude-code/managed-settings.json"
fi

if [[ -f "$MANAGED" ]]; then
  rm -f "$MANAGED"
  ok "managed-settings.json removed"
else
  skip "managed-settings.json not present"
fi

# ── Step 4: remove install directory ─────────────────────────────────────────
info "[4/4] Removing install directory..."

if [[ -d "$CONFIG_DIR" ]]; then
  if [[ "$KEEP_CONFIG" == "1" ]]; then
    rm -rf "$CONFIG_DIR/app"
    ok "App removed (config.json kept at $CONFIG_DIR/config.json)"
  else
    rm -rf "$CONFIG_DIR"
    ok "Removed $CONFIG_DIR"
  fi
else
  skip "Install directory not found"
fi

echo
echo "  ================================"
echo "  Deja uninstalled."
echo "  Claude Code will resume direct upstream connection."
echo

# Remove deja shim added by installer
DEJA_LINK="$HOME/.local/bin/deja"
if [[ -f "$DEJA_LINK" ]]; then
  rm -f "$DEJA_LINK"
  echo "  ✓  Removed deja command ($DEJA_LINK)"
fi
