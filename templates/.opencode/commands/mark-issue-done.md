---
description: Close the active Hero issue with a completion comment
---

Run the `mark-issue-done` tool with the issue number from the active context.

- Read `.hero/state.json` for `activeIssueId` if available, otherwise ask the user which issue to close.
- After the tool returns, confirm closure to the user. If `closed` is false, surface the reason verbatim.
