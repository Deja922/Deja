#!/usr/bin/env bash

set -euo pipefail

GITHUB_OWNER="Deja922"
GITHUB_REPO="Deja"
INSTALL_DIR="$HOME/.deja/app"
CONFIG_DIR="$HOME/.deja"

API_KEY=""
UPSTREAM=""
PROVIDER=""
PORT="9090"
RELEASE_TAG=""
UNATTENDED="0"

info() {
  echo "  $*"
}

ok() {
  echo "  OK  $*"
}

warn() {
  echo "  WARN  $*" >&2
}

err() {
  echo "  ERROR  $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Options:
  --api-key <key>       Upstream API key
  --upstream <url>      Upstream base URL
  --provider <name>     aihubmix | anthropic | custom
  --port <number>       Local proxy port (default: 9090)
  --release-tag <tag>   GitHub release tag (default: latest)
  --yes                 Non-interactive install
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)
      [[ $# -ge 2 ]] || err "missing value for --api-key"
      API_KEY="$2"
      shift 2
      ;;
    --upstream)
      [[ $# -ge 2 ]] || err "missing value for --upstream"
      UPSTREAM="$2"
      shift 2
      ;;
    --provider)
      [[ $# -ge 2 ]] || err "missing value for --provider"
      PROVIDER="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || err "missing value for --port"
      PORT="$2"
      shift 2
      ;;
    --release-tag)
      [[ $# -ge 2 ]] || err "missing value for --release-tag"
      RELEASE_TAG="$2"
      shift 2
      ;;
    --yes)
      UNATTENDED="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "unknown option: $1"
      ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*)
    err "port must be numeric"
    ;;
esac

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux) PLATFORM="linux" ;;
  *) err "unsupported OS: $OS (install.sh currently supports macOS/Linux)" ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH_TAG="x64" ;;
  arm64|aarch64) ARCH_TAG="arm64" ;;
  *) err "unsupported CPU architecture: $ARCH" ;;
esac

echo
echo "  Deja Context Engine - Install"
echo "  ============================="
echo

info "[1/5] Checking dependencies..."
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node.js 18+ from https://nodejs.org"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  err "Node.js $(node --version) is too old. Node.js 18+ is required."
fi
if ! command -v curl >/dev/null 2>&1; then
  err "curl is required"
fi
if ! command -v tar >/dev/null 2>&1 && ! command -v unzip >/dev/null 2>&1; then
  err "tar or unzip is required"
fi
ok "Node.js $(node --version)"

info
info "[2/5] Downloading Deja release..."
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

RELEASE_INFO="$(
  node - "$GITHUB_OWNER" "$GITHUB_REPO" "${RELEASE_TAG:-latest}" "$PLATFORM" "$ARCH_TAG" <<'NODE'
const https = require("https");

const [owner, repo, tag, platform, arch] = process.argv.slice(2);
const useLatest = tag === "latest";
const apiPath = useLatest
  ? `/repos/${owner}/${repo}/releases/latest`
  : `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;

function requestJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: pathname,
        method: "GET",
        headers: {
          "User-Agent": "deja-installer/1.0",
          "Accept": "application/vnd.github+json"
        }
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`invalid JSON from GitHub API: ${e.message}`));
            }
            return;
          }
          reject(new Error(`GitHub API error ${res.statusCode}: ${data.slice(0, 240)}`));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function scoreAsset(name, platform, arch) {
  const lower = String(name || "").toLowerCase();
  const platformTokens = platform === "darwin" ? ["mac", "darwin", "osx"] : ["linux"];
  const archTokens = arch === "x64" ? ["x64", "amd64", "x86_64"] : ["arm64", "aarch64"];

  let score = 0;
  if (platformTokens.some((t) => lower.includes(t))) score += 10;
  if (archTokens.some((t) => lower.includes(t))) score += 10;
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) score += 3;
  if (lower.endsWith(".zip")) score += 2;
  if (lower.includes("tray")) score += 1;
  return score;
}

async function main() {
  const release = await requestJson(apiPath);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!assets.length) {
    throw new Error("release has no assets");
  }

  const candidates = assets
    .map((asset) => ({
      name: asset.name || "",
      url: asset.browser_download_url || "",
      score: scoreAsset(asset.name || "", platform, arch)
    }))
    .filter((asset) => asset.url && (asset.name.endsWith(".zip") || asset.name.endsWith(".tar.gz") || asset.name.endsWith(".tgz")))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    throw new Error("no zip/tar.gz assets found in release");
  }

  const best = candidates[0];
  if (best.score < 10) {
    throw new Error(`no platform-matching asset found for ${platform}-${arch}`);
  }

  process.stdout.write(`${release.tag_name}\n${best.name}\n${best.url}\n`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"

RELEASE_TAG_FOUND="$(echo "$RELEASE_INFO" | sed -n '1p')"
ASSET_NAME="$(echo "$RELEASE_INFO" | sed -n '2p')"
ASSET_URL="$(echo "$RELEASE_INFO" | sed -n '3p')"

[[ -n "$RELEASE_TAG_FOUND" && -n "$ASSET_NAME" && -n "$ASSET_URL" ]] || err "failed to resolve release asset"

ok "Version: $RELEASE_TAG_FOUND"
info "Asset: $ASSET_NAME"

ARCHIVE_PATH="$TMP_DIR/$ASSET_NAME"
curl -fL --connect-timeout 20 --retry 3 --retry-delay 2 -o "$ARCHIVE_PATH" "$ASSET_URL"

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

case "$ASSET_NAME" in
  *.tar.gz|*.tgz)
    tar -xzf "$ARCHIVE_PATH" -C "$INSTALL_DIR"
    ;;
  *.zip)
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$ARCHIVE_PATH" -d "$INSTALL_DIR"
    else
      tar -xf "$ARCHIVE_PATH" -C "$INSTALL_DIR"
    fi
    ;;
  *)
    err "unsupported archive format: $ASSET_NAME"
    ;;
esac

APP_ROOT="$INSTALL_DIR"
if [[ ! -f "$APP_ROOT/package.json" ]]; then
  FOUND_PKG="$(find "$INSTALL_DIR" -maxdepth 3 -type f -name package.json | head -n 1 || true)"
  [[ -n "$FOUND_PKG" ]] || err "package.json not found after extraction"
  APP_ROOT="$(dirname "$FOUND_PKG")"
fi

cd "$APP_ROOT"
npm ci --omit=dev --prefer-offline || npm install --omit=dev
echo "$RELEASE_TAG_FOUND" > "$APP_ROOT/VERSION"
ok "Installed to $APP_ROOT"

# Create deja symlink so users can run `deja` directly
DEJA_LINK="$HOME/.local/bin/deja"
DEJA_NODE_BIN="$APP_ROOT/dist/cli/deja.js"
if command -v node >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  printf '#!/usr/bin/env sh\nexec node "%s" "$@"\n' "$DEJA_NODE_BIN" > "$DEJA_LINK"
  chmod +x "$DEJA_LINK"
  # Add ~/.local/bin to PATH in shell profile if not already present
  for profile in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [[ -f "$profile" ]] && ! grep -q '\.local/bin' "$profile" 2>/dev/null; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$profile"
      break
    fi
  done
  ok "deja command installed → $DEJA_LINK"
  info "(run 'source ~/.zshrc' or open a new terminal to use 'deja' directly)"
fi

info
info "[3/5] Writing config..."
if [[ "$UNATTENDED" != "1" && -z "$PROVIDER" ]]; then
  echo "  Select provider:"
  echo "    [1] aihubmix (recommended)"
  echo "    [2] anthropic"
  echo "    [3] custom"
  read -r -p "  Enter number (1-3) [default: 1]: " choice
  choice="${choice:-1}"
  case "$choice" in
    1) PROVIDER="aihubmix" ;;
    2) PROVIDER="anthropic" ;;
    3) PROVIDER="custom" ;;
    *) PROVIDER="aihubmix" ;;
  esac
fi

case "${PROVIDER:-aihubmix}" in
  aihubmix|1)
    PROVIDER_NAME="aihubmix"
    : "${UPSTREAM:=https://aihubmix.com}"
    ;;
  anthropic|2)
    PROVIDER_NAME="anthropic"
    : "${UPSTREAM:=https://api.anthropic.com}"
    ;;
  custom|3)
    PROVIDER_NAME="custom"
    if [[ -z "$UPSTREAM" && "$UNATTENDED" != "1" ]]; then
      read -r -p "  Enter upstream URL: " UPSTREAM
    fi
    [[ -n "$UPSTREAM" ]] || err "custom provider requires --upstream"
    ;;
  *)
    err "invalid provider: $PROVIDER"
    ;;
esac

UPSTREAM="${UPSTREAM%/}"

if [[ -z "$API_KEY" && "$UNATTENDED" != "1" ]]; then
  read -r -p "  API key (optional, press Enter to skip): " API_KEY
fi

mkdir -p "$CONFIG_DIR"
PORT="$PORT" UPSTREAM="$UPSTREAM" PROVIDER_NAME="$PROVIDER_NAME" API_KEY="$API_KEY" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || "9090");
const upstream = process.env.UPSTREAM || "https://aihubmix.com";
const providerName = process.env.PROVIDER_NAME || "aihubmix";
const apiKey = process.env.API_KEY || "";

const compatMode = upstream.includes("/v1") ? "openai" : "anthropic";
const config = {
  port,
  pipeline: {
    maxTokens: 8000,
    targetTokens: 4000,
    rankingThreshold: 0.3,
    memoryEnabled: false,
    memoryTopK: 5,
    compressThreshold: 200
  },
  providers: {
    [providerName]: {
      baseUrl: upstream,
      ...(apiKey ? { apiKey } : {}),
      compatMode
    }
  },
  defaultProvider: providerName
};

const outputPath = path.join(process.env.HOME, ".deja", "config.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
NODE

ok "Config written: $CONFIG_DIR/config.json"
ok "Upstream: $UPSTREAM"

info
info "[4/5] Starting service..."
if [[ "$PLATFORM" == "darwin" ]]; then
  node "$APP_ROOT/dist/cli/deja.js" service:install
  ok "LaunchAgent installed (macOS)"
else
  node "$APP_ROOT/dist/cli/deja.js" start --daemon --port "$PORT"
  ok "Daemon started (Linux)"
fi

info
info "[5/5] Health check..."
sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  ok "Health endpoint is ready: http://127.0.0.1:${PORT}/health"
else
  warn "Service is still starting. Re-check in a few seconds:"
  warn "curl http://127.0.0.1:${PORT}/health"
fi

DASHBOARD_URL="http://127.0.0.1:${PORT}/__deja__"

echo
echo "  ============================="
echo "  Install complete"
echo "  ============================="
echo
echo "  Config      : $CONFIG_DIR/config.json"
echo "  Dashboard   : $DASHBOARD_URL"
echo "  Doctor      : node $APP_ROOT/dist/cli/deja.js doctor --port $PORT"
echo "  Tools setup : node $APP_ROOT/dist/cli/deja.js tools:install all --port $PORT"
echo
echo "  Opening dashboard in browser..."
if [[ "$PLATFORM" == "darwin" ]]; then
  sleep 2
  open "$DASHBOARD_URL" 2>/dev/null || echo "  Bookmark this URL: $DASHBOARD_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  sleep 2
  xdg-open "$DASHBOARD_URL" 2>/dev/null || echo "  Bookmark this URL: $DASHBOARD_URL"
else
  echo "  Bookmark this URL: $DASHBOARD_URL"
fi
echo
