#!/usr/bin/env bash
# Refresh the code_map explorer: extract symbol/reference/test data from the
# TypeScript program, then render the static HTML site. Re-run after code changes.
#
#   bash code_map/scripts/refresh.sh        # from the package root, or anywhere
#   open @ephai/agent-core/code_map_index.html  # entry page
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TSX="node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "error: $TSX not found — run 'pnpm install' in $ROOT" >&2
  exit 1
fi

echo "▸ extract  (TypeScript Program → code_map/data/*.json)"
"$TSX" code_map/scripts/extract/main.ts

echo "▸ render   (JSON → code_map/*.html + assets)"
"$TSX" code_map/scripts/render/main.ts

echo "✓ done — open code_map_index.html"
