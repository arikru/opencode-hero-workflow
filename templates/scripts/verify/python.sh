#!/usr/bin/env bash
# Hero Python verifier: ruff -> mypy -> pytest. Each check soft-fails so we can collect
# all output and the AI sees a single coherent report at the end.
set -e
set -u
set -o pipefail

PROJECT_ROOT="${HERO_PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT"

# Per-check accumulators: status (pass|fail|skipped), reason (for skips), buffered output.
ruff_status=""
ruff_reason=""
ruff_output=""
mypy_status=""
mypy_reason=""
mypy_output=""
pytest_status=""
pytest_reason=""
pytest_output=""

# --- ruff -------------------------------------------------------------------
if command -v ruff >/dev/null 2>&1; then
  if ruff_output="$(ruff check . 2>&1)"; then
    ruff_status="pass"
  else
    ruff_status="fail"
  fi
else
  ruff_status="skipped"
  ruff_reason="ruff not on PATH"
fi

# --- mypy -------------------------------------------------------------------
mypy_configured="false"
if [ -f "mypy.ini" ]; then
  mypy_configured="true"
elif [ -f "pyproject.toml" ] && grep -q '^\[tool\.mypy\]' pyproject.toml 2>/dev/null; then
  mypy_configured="true"
fi

if [ "$mypy_configured" = "true" ]; then
  if command -v mypy >/dev/null 2>&1; then
    if mypy_output="$(mypy . 2>&1)"; then
      mypy_status="pass"
    else
      mypy_status="fail"
    fi
  else
    mypy_status="skipped"
    mypy_reason="mypy not on PATH"
  fi
else
  mypy_status="skipped"
  mypy_reason="no config"
fi

# --- pytest -----------------------------------------------------------------
has_tests="false"
if [ -d "tests" ]; then
  has_tests="true"
elif find . -maxdepth 4 -name 'test_*.py' -type f 2>/dev/null | head -1 | grep -q .; then
  has_tests="true"
fi

if [ "$has_tests" = "true" ]; then
  if command -v pytest >/dev/null 2>&1; then
    if pytest_output="$(pytest -x --tb=short 2>&1)"; then
      pytest_status="pass"
    else
      pytest_status="fail"
    fi
  else
    pytest_status="skipped"
    pytest_reason="pytest not on PATH"
  fi
else
  pytest_status="skipped"
  pytest_reason="no tests dir"
fi

# --- single coherent report -------------------------------------------------
if [ "$ruff_status" != "skipped" ] && [ -n "$ruff_output" ]; then
  echo "--- ruff ---"
  echo "$ruff_output"
  echo
fi
if [ "$mypy_status" != "skipped" ] && [ -n "$mypy_output" ]; then
  echo "--- mypy ---"
  echo "$mypy_output"
  echo
fi
if [ "$pytest_status" != "skipped" ] && [ -n "$pytest_output" ]; then
  echo "--- pytest ---"
  echo "$pytest_output"
  echo
fi

format_line() {
  local name="$1"
  local status="$2"
  local reason="$3"
  if [ "$status" = "skipped" ] && [ -n "$reason" ]; then
    printf "  %-7s %s (%s)\n" "$name:" "$status" "$reason"
  else
    printf "  %-7s %s\n" "$name:" "$status"
  fi
}

echo "verify summary:"
format_line "ruff" "$ruff_status" "$ruff_reason"
format_line "mypy" "$mypy_status" "$mypy_reason"
format_line "pytest" "$pytest_status" "$pytest_reason"

# Non-zero exit iff any check actually failed (skips don't count).
if [ "$ruff_status" = "fail" ] || [ "$mypy_status" = "fail" ] || [ "$pytest_status" = "fail" ]; then
  exit 1
fi
exit 0
