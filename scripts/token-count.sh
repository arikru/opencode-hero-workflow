#!/usr/bin/env bash
# Hero approximate token counter: char-count / 4 heuristic.
# Reads from stdin if no file args, else sums character counts across all file args.
# This is intentionally not a real tokenizer — see prd.md "Token estimation".
set -e
set -u
set -o pipefail

# Count characters portably: prefer `wc -m` (multibyte-aware); fall back to `wc -c`.
count_chars() {
  if wc -m </dev/null >/dev/null 2>&1; then
    wc -m "$@"
  else
    wc -c "$@"
  fi
}

if [ "$#" -eq 0 ]; then
  CHARS="$(count_chars | tr -d ' ')"
else
  # Concatenate all file args through stdin to get a single total without
  # parsing wc's per-file/total output across BSD/GNU variants.
  CHARS="$(cat -- "$@" | count_chars | tr -d ' ')"
fi

# Default empty-string guard (shouldn't happen, but keep set -u happy).
CHARS="${CHARS:-0}"

# Round to nearest integer: (chars + 2) / 4 using integer math.
TOKENS=$(( (CHARS + 2) / 4 ))

echo "Approximate token count: ${TOKENS}"
echo "Approximate (heuristic char-count / 4); not a real tokenizer."
