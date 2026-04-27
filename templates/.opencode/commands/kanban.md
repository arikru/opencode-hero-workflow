---
description: Break a PRD into vertical-slice GitHub issues with blockers and hero:ready labels
argument-hint: [prd-path]
---

Load the `hero-kanban` skill. If `[prd-path]` is given, use it; otherwise read the most recent PRD under `.hero/prds/`.

Confirm the proposed issue list with the user before invoking `gh issue create`. After creation, summarise the board.
