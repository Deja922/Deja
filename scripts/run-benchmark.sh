#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ANTHROPIC_API_KEY=... [ANTHROPIC_BASE_URL=...] ./scripts/run-benchmark.sh [workflow] [rounds] [mode]
#
# Never hardcode real keys in repository files.
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is required."
  echo "Example:"
  echo "  export ANTHROPIC_API_KEY='your-key'"
  echo "  export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic'   # optional"
  exit 1
fi

: "${ANTHROPIC_BASE_URL:=https://api.anthropic.com}"
export ANTHROPIC_BASE_URL

WORKFLOW="${1:-coding}"
ROUNDS="${2:-20}"
MODE="${3:-both}"

echo "=== Benchmark: $WORKFLOW workflow, $ROUNDS rounds, $MODE mode ==="
cd "$(dirname "$0")/.."

npx tsx src/cli/long-eval.ts \
  --workflow "$WORKFLOW" \
  --provider claude \
  --model claude-sonnet-4-6 \
  --mode "$MODE" \
  --max-tokens 8000 \
  --target-tokens 3000 \
  --rounds "$ROUNDS"

echo "=== Done: $WORKFLOW ==="
