---
description: Break a plan or PRD into independently-grabbable vertical-slice GitHub issues
argument-hint: [issue-number-or-url]
---

Load the `hero-kanban` skill. If `[issue-number-or-url]` is given, fetch it with `gh issue view`; otherwise work from whatever plan or PRD is already in the conversation context.

Confirm the proposed issue list with the user before invoking `gh issue create`. After creation, summarise the board.
