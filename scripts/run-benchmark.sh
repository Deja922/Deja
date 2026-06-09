#!/bin/bash
export ANTHROPIC_API_KEY="sk-d497bbc5c90d42f59f605fe05a808970"
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"

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
