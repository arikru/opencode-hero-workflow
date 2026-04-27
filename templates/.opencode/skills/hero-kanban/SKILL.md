---
name: hero-kanban
description: Decompose a Hero PRD into vertical-slice GitHub issues with hero:ready/hero:blocked labels and blocker relationships. Loaded when the user runs /kanban.
---

# Kanban

You are converting a PRD into a board of vertical-slice tickets. The destination is GitHub Issues.

## What "vertical slice" means

Each issue must:
- Deliver an end-to-end behaviour that can be acceptance-tested.
- Not depend on issues that are not yet `hero:ready` (only on issues that are or will be marked ready).
- Be small enough that a TDD agent can finish it in one focused session (≤ 1 day equivalent of work).
- Make sense to ship alone (even if it's not literally shipped alone, it must be self-contained).

What it must NOT be: a horizontal layer ticket like "set up the database schema" or "build the auth middleware". Those split a slice across multiple tickets and create false dependencies.

## Process

1. Read the PRD the user references (or `.hero/prds/<latest>.md` if none specified). Identify each user story.
2. For each story, draft one or more vertical-slice issues. A 1:1 mapping is fine; some stories may need 2 slices (e.g. happy path + error path). Many stories collapse into one slice.
3. For each issue, write:
   - **Title**: short, imperative (≤ 70 chars).
   - **Body**: three sections — `## What to build`, `## Acceptance criteria` (checklist), `## Blocked by` (issue numbers or "None — can start immediately").
4. Identify blocker relationships. Issue B is blocked by A if A's deliverable is a prerequisite the agent working on B will need (e.g. a config schema, a shared module, an installed dependency).
5. Confirm the full list with the user **before** creating any issues. Format as a markdown table or list. Wait for explicit go-ahead.
6. On go-ahead, create issues via `gh issue create` with labels: `hero:ready` for unblocked issues; `hero:blocked` (alongside `hero:ready`) for issues that have unfinished blockers. The exact label names are configurable in `.hero/config.jsonc` under `github.labels` — read those if present, default to the names above.
7. After creation, print the issue numbers and URLs.

## Discipline

- **Don't fan out tickets.** A 30-issue board is rarely better than a 12-issue board. If you can't justify why an issue is its own ticket, fold it into a sibling.
- **Block conservatively.** Two issues that *could* be done in either order are not blocked on each other. Reserve the blocker relationship for hard prerequisites.
- **Don't write implementation in the body.** The body says what and why. The TDD agent picks the how at run time.
- **Reference the PRD.** Each issue body's first line links the source PRD path so the implementing agent has context.
