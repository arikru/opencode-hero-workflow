---
description: Estimate current session token usage and remind of smart-zone thresholds
---

Estimate current context usage and report:

1. Run `!scripts/token-count.sh` against the active session transcript or read the latest message thread, whichever is available.
2. Output the approximate token count, labelled "approximate" so the user understands the figure is heuristic, not exact.
3. Compare against the configured smart-zone thresholds (`tokenBudget.warnAt` and `tokenBudget.alarmAt` from `.hero/config.jsonc`, defaulting to 80K / 100K).
4. Recommend `/clear` if approaching or exceeding `warnAt`; strongly recommend `/clear` past `alarmAt`.

Stay terse — this is a status check, not an analysis.
