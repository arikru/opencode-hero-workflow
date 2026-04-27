---
description: Audit a PR or branch diff with the reviewer model and push-style standards
argument-hint: <pr-or-branch>
---

Spawn a fresh subagent context using the model named at `models.reviewer` in `.hero/config.jsonc`. The subagent loads the `hero-reviewer-standards` skill.

Provide the subagent with:
- The diff: `!git diff <base>...<branch>` (or `!gh pr diff <pr-number>`).
- The issue body, if a Hero issue is referenced in the PR description: `!gh issue view <number>`.
- The verify result: `!scripts/verify.sh` (so the reviewer knows the suite state).

Pipe the subagent's structured review back to the user verbatim. Do not edit or soften it.
