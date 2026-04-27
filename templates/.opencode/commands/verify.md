---
description: Run the verify suite and interpret results
---

Run the `verify` custom tool. After it returns:

- If `passed` is true, summarise that all checks passed in one sentence.
- If `passed` is false, identify which check failed by reading the verify summary in `output` and quote the relevant excerpt.
- Always include the exit status explicitly so the user sees pass/fail at a glance.
