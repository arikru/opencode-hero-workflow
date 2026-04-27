---
description: Pick the next unblocked Hero issue and load it into context
---

Run the `pick-next-issue` custom tool. If `found` is false, surface the reason and stop. Otherwise:

- Quote the issue number and title.
- Run `!gh issue view <number>` to load the full issue body and any comments into context.
- Confirm with the user before starting any implementation work.
