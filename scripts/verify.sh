#!/usr/bin/env bash
# Hero verify dispatcher: detects stack and routes to the right verifier.
# Source-of-truth lives in this repo; the init scaffolder copies it into user projects.
set -e
set -u
set -o pipefail

# Resolve script directory so we can find sibling verifiers when HERO_PROJECT_ROOT is unset.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${HERO_PROJECT_ROOT:-$SCRIPT_DIR/..}"

# Resolve stack: explicit override beats auto-detection.
STACK="${HERO_STACK:-auto}"

if [ "$STACK" = "auto" ]; then
  if [ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/requirements.txt" ]; then
    STACK="python"
  elif [ -f "$PROJECT_ROOT/package.json" ]; then
    STACK="node"
  else
    STACK="unknown"
  fi
fi

# Locate verifier scripts: prefer HERO_PROJECT_ROOT/scripts when present, else co-located.
if [ -d "$PROJECT_ROOT/scripts/verify" ]; then
  VERIFY_DIR="$PROJECT_ROOT/scripts/verify"
else
  VERIFY_DIR="$SCRIPT_DIR/verify"
fi

case "$STACK" in
  python)
    exec bash "$VERIFY_DIR/python.sh"
    ;;
  node)
    exec bash "$VERIFY_DIR/node.sh"
    ;;
  unknown)
    echo "unknown stack: set HERO_STACK in .hero/config.jsonc (one of: python, node)" >&2
    # Soft-exit: Hero must never break the user's session on missing stack config.
    exit 0
    ;;
  *)
    echo "unknown stack '$STACK': set HERO_STACK in .hero/config.jsonc (one of: python, node)" >&2
    exit 0
    ;;
esac
