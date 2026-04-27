---
description: Launch a Sandcastle AFK run against the hero:ready issue board
---

You are starting a night-shift AFK run. The user is going to bed, so be thorough about pre-flight checks before you start spawning sandboxes.

## Pre-flight (do these in order, fail fast)

1. **Sandcastle enabled?** Read `.hero/config.jsonc`. If `sandcastle.enabled` is not `true`, refuse with a one-liner: "Sandcastle is disabled in `.hero/config.jsonc`. Set `sandcastle.enabled: true` and re-run `bunx github:org/opencode-hero-workflow#<version> init` to scaffold the orchestrator." Stop.
2. **Sandcastle binary present?** Run `!which sandcastle` (or `!command -v sandcastle`). If missing, refuse and tell the user to `bun add -g sandcastle` (or whatever the project's install path is). Stop.
3. **Sandcastle main.ts scaffolded?** Check that `.sandcastle/main.ts` exists in the user's project. If missing, tell the user to run `bunx github:org/opencode-hero-workflow#<version> init` to scaffold it. Stop.
4. **OpenCode auth present?** Run `!ls ~/.local/share/opencode 2>/dev/null` and confirm it returns a non-empty listing. If missing, tell the user to run `opencode auth login` first. Stop.
5. **Issue board has work?** Run the `pick-next-issue` custom tool with the active config. If `found` is false, refuse with: "No `hero:ready` issues to process — the issue board is empty or fully blocked. Nothing to do." Stop.
6. **Git working tree clean?** Run `!git status --porcelain`. If output is non-empty, ask the user to confirm — uncommitted work could be lost if a sandbox iteration touches the same files. Wait for explicit go-ahead before continuing.

## Launching the AFK run

Once pre-flight passes:

1. Show the user a summary: count of `hero:ready` (unblocked) issues, the configured `sandcastle.maxIterations`, and `sandcastle.idleTimeoutSeconds`. Get explicit confirmation.
2. On go-ahead, run `!bunx sandcastle .sandcastle/main.ts` from the project root. Stream the output (or tail the log file if Sandcastle writes one).
3. Sandcastle's main.ts (already scaffolded by Hero) iterates the issue board, spawns one implementer and one reviewer sandbox per issue, and watches for `<promise>COMPLETE</promise>` or `<promise>BLOCKED reason="..."</promise>` per the prompt template's contract.

## During the run

You are the human's proxy. The user is asleep. Do not make decisions for them — Sandcastle does that. Your job is to:

- Surface fatal errors (sandcastle crash, network loss, auth expiry) immediately if they happen.
- Track per-iteration outcomes — for each issue, log COMPLETE or BLOCKED with reason.
- Do NOT amend, force-push, or close issues yourself; the implementer and reviewer sandboxes do that via the `mark-issue-done` tool.

## On exit

When Sandcastle exits (max iterations reached, idle timeout, or all `hero:ready` issues exhausted):

1. Print a summary table: issue number, status (COMPLETE/BLOCKED/ERROR), short reason for non-completes.
2. List any new PRs opened (`!gh pr list --author @me --state open`) so the user has a single place to find the morning's work.
3. Tell the user the run is over. Do not start another run.

## Limitations to disclose if asked

- Streaming UX is not available with the OpenCode provider in Sandcastle: per-iteration output appears as complete chunks.
- Per-iteration token usage is not visible.
- Session resume across iterations is not supported.

These are documented in the PRD ("Further Notes" → "Sandcastle known limitations"). Do not pretend otherwise.
