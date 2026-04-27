# PRD: opencode-hero-workflow

## Problem Statement

Engineering teams using OpenCode lack a structured, opinionated workflow that guides them from ambiguous ideas through to production-grade, AI-assisted implementation. Without this, developers default to ad-hoc, chat-style AI use — skipping alignment sessions, writing horizontal layers instead of vertical slices, running agents without TDD feedback loops, and accumulating technical debt from under-tested shallow-module codebases. The result is AI output that works but lacks quality, taste, and architectural integrity.

## Solution

A distributable internal npm package (`opencode-hero-workflow`) that encodes Matt Pocock's "Essential Skills for AI Coding from Planning to Production" workflow as a set of OpenCode primitives: an event-driven plugin, a suite of agent skills, a set of slash commands, shell scripts, and a Sandcastle integration for AFK (away-from-keyboard) autonomous runs. The package is installed once per project via a scaffolding CLI and provides a complete day-shift (human-in-the-loop) and night-shift (AFK) pipeline.

## User Stories

1. As a developer, I want to run `/grill <topic>` to trigger a one-question-at-a-time alignment session so that I reach shared understanding with the AI before any code is written.
2. As a developer, I want the agent to be in Plan mode by default so that it proposes changes before making them.
3. As a developer, I want to run `/prd` after a grilling session so that the AI synthesises our alignment into a structured PRD written to `.hero/prds/<slug>.md`.
4. As a developer, I want to run `/kanban` so that the AI breaks a PRD into vertical-slice GitHub Issues with blocker relationships, labelled with `hero:ready`.
5. As a developer, I want to run `/pick-task` so that the AI selects the highest-priority unblocked issue from the GitHub board and loads it into context.
6. As a developer, I want to run `/tdd <issue-ref>` so that the agent follows red-green-refactor discipline for the selected issue.
7. As a developer, I want the plugin to run `verify.sh` asynchronously after every file edit so that lint, type check, and test failures surface in the next AI turn without blocking me.
8. As a developer, I want the plugin to toast a warning when my session approaches 80K tokens and again at 100K so that I know when to `/clear` and start a fresh context.
9. As a developer, I want to run `/verify` explicitly so that the full verification suite runs and the AI interprets the results.
10. As a developer, I want to run `/review <pr-or-branch>` so that a fresh subagent context, using the reviewer model, applies push-style coding standards to the diff.
11. As a developer, I want to run `/architecture-scan` so that the AI loads the `hero-improve-architecture` skill and proposes deep-module consolidations for shallow-module clusters in the codebase.
12. As a developer, I want to run `/context-status` so that the AI reports an approximate token count and reminds me of the smart-zone threshold.
13. As a developer, I want `/ralph` to trigger a Sandcastle AFK run against the current issue board so that the AI can autonomously implement multiple issues overnight.
14. As a developer, I want to run `bunx github:org/opencode-hero-workflow#v0.1.0 init` once per project so that all skills, commands, scripts, and config are scaffolded into the repo.
15. As a developer, I want the init scaffolder to interactively prompt me for model roles (implementer, reviewer, planner) so that I can choose any OpenCode-supported provider (e.g., `github-copilot/claude-sonnet-4.5`) without hardcoded defaults.
16. As a developer, I want the plugin to block reads of `.env*` files and `git push --force` so that secrets never enter AI context and destructive ops are prevented during AFK runs.
17. As a developer, I want the plugin to warn me on `session.compacted` so that I learn to prefer `/clear` over compaction, per the smart-zone philosophy.
18. As a developer, I want the plugin to inject minimal continuation context (current PRD path, active issue ID) if compaction does happen so that the AI can recover gracefully.
19. As a developer, I want the plugin to emit a local version-drift toast on startup when my on-disk scaffold is out of sync with the installed npm package version so that I know to re-run `init`.
20. As a developer, I want to pin an exact git tag in `opencode.json` so that upgrades are deliberate and never silent.
21. As a developer, I want all Hero config in `.hero/config.jsonc` with Zod runtime validation and a JSON Schema sidecar for editor autocomplete so that misconfiguration is caught early with a clear error message.
22. As a developer, I want the Sandcastle integration to bind-mount my host's `~/.local/share/opencode` (readonly) into the sandbox so that any OpenCode-supported model provider (including GitHub Copilot) authenticates correctly inside AFK runs.
23. As a developer, I want `verify.sh` to auto-detect my stack and dispatch to `verify/python.sh` (ruff → mypy → pytest) so that Python projects get correct verification with no manual config.
24. As a developer, I want `.hero/config.jsonc` to have a `verify.enabled` kill switch so that I can disable the post-edit verify hook on large repos without uninstalling Hero.
25. As a developer, I want the scaffolded `.sandcastle/main.ts` to read model roles from `.hero/config.jsonc` so that there is a single source of truth for model selection across interactive and AFK runs.
26. As a developer, I want the GitHub issue board to use configurable labels (`hero:ready`, `hero:in-progress`, `hero:blocked`) so that my team can adopt or override the labelling scheme.
27. As a developer, I want the `pick-next-issue` and `mark-issue-done` custom tools to use `gh issue list/close` so that issue state is tracked in GitHub, not in local files.
28. As a developer, I want the scaffolded Sandcastle `prompt.md` to reference Hero skill names and use `!`gh issue view {{ISSUE_NUMBER}}`` for issue context so that AFK agents have the same workflow discipline as interactive ones.
29. As a developer, I want the scaffolder to be idempotent with content-hash conflict detection and a `--force` flag so that re-running `init` after an upgrade does not silently overwrite files I have customised.
30. As a developer, I want `bin/init.js` to patch `opencode.json` to add the plugin reference and set `defaultMode: "plan"` so that a fresh project is correctly configured in one command.

## Implementation Decisions

### Modules to build

- **`plugin/index.ts`** — Plugin entry point; registers all hooks and custom tools with the OpenCode plugin API. Thin orchestrator; delegates to sub-modules.
- **`plugin/config.ts`** — Zod schema for `.hero/config.jsonc`; loader with JSONC parsing (Bun native); emits structured error on invalid config. Generates `schemas/hero-schema.json` at build time via `zod-to-json-schema`.
- **`plugin/hooks/token-budget.ts`** — Listens on `message.updated`/`session.updated`; approximate token count via tiktoken-style heuristic; fires `tui.toast.show` at 80K and 100K thresholds.
- **`plugin/hooks/verify.ts`** — Listens on `tool.execute.after` for `edit`/`write` tools; 5-second debounce; spawns `scripts/verify.sh` async via Bun `$`; skips if a verify is already in-flight; posts results to `client.app.log`.
- **`plugin/hooks/compaction.ts`** — Listens on `session.compacted`; fires warning toast. Also implements `experimental.session.compacting` to inject current PRD path and active issue ID into continuation context.
- **`plugin/hooks/guardrails.ts`** — `tool.execute.before` hook; blocks reads matching `.env*`; blocks bash commands matching `git push --force`.
- **`plugin/hooks/shell-env.ts`** — `shell.env` hook; injects `HERO_STACK` (auto-detected or from config) and `HERO_PROJECT_ROOT`.
- **`plugin/version-check.ts`** — On plugin init; compares npm package version to `.hero/.hero-version`; fires toast with one-line fix instruction on mismatch.
- **`plugin/tools/verify.ts`** — Custom tool `verify`; invokes `scripts/verify.sh`; returns structured `{ passed, output }`.
- **`plugin/tools/pick-next-issue.ts`** — Custom tool `pick-next-issue`; runs `gh issue list --label hero:ready --json number,title,body` filtered for no `hero:blocked`; returns highest-priority item.
- **`plugin/tools/mark-issue-done.ts`** — Custom tool `mark-issue-done`; runs `gh issue close <number> --comment "Completed by Hero workflow"`.
- **`scripts/verify.sh`** — Stack detection dispatcher; reads `HERO_STACK` env; falls back to auto-detect via `pyproject.toml`/`requirements.txt`; dispatches to `verify/python.sh` or prints warning for unknown stacks.
- **`scripts/verify/python.sh`** — Runs `ruff check .`, `mypy .` (if configured), `pytest -x --tb=short` (if tests dir exists); each soft-fails to collect full report.
- **`scripts/token-count.sh`** — Approximate token count via wc-based heuristic; labeled "approximate" in output.
- **`scripts/prime-context.sh`** — Outputs `git log --oneline -10`, `git status`, and a shallow file tree summary.
- **`bin/init.js`** — Interactive scaffolder; prompts for model roles, sandbox provider, GitHub repo, Sandcastle enablement; copies skills/commands/scripts/templates into `.opencode/` and `.hero/`; patches `opencode.json`; writes `.hero/config.jsonc` and `.hero/.hero-version`; idempotent with SHA-256 content-hash manifest; `--force` flag; `--migrate` flag for non-breaking schema migrations; refuses on major-version config mismatch.
- **`sandcastle/main.ts.template`** — Hero's customised Sandcastle `main.ts`; reads model roles from `.hero/config.jsonc`; adds OpenCode auth bind-mount; uses `parallel-planner-with-review` structure with separate `sandbox.run()` calls for implementer and reviewer models.
- **`sandcastle/prompt.md.template`** — AFK prompt referencing Hero skill names (`hero-tdd-loop`, `hero-reviewer-standards`); uses `!`gh issue view {{ISSUE_NUMBER}}`` for issue context; includes `<promise>COMPLETE</promise>` termination signal.

### Key interfaces

- `HeroConfig` — Zod-validated shape of `.hero/config.jsonc`. Fields: `version`, `models` (`implementer`, `reviewer`, `planner`), `stack`, `verify` (`enabled`, `debounceMs`, `commands`), `tokenBudget` (`warnAt`, `alarmAt`), `guardrails` (`blockEnvReads`, `blockForcePush`), `github` (`repo`, `labels`), `sandcastle` (`enabled`, `sandboxProvider`, `imageName`, `mountOpencodeAuth`, `maxIterations`, `idleTimeoutSeconds`).
- All plugin hooks receive `HeroConfig` via a shared context created at plugin init; no re-reading config per hook invocation.

### Architectural decisions

- **Distribution**: private GitHub repo, git-URL spec (`github:org/repo#vX.Y.Z`), resolved by Bun at OpenCode startup. Exact tag pins only — no branch refs.
- **Skills and commands are file artifacts**, not runtime-registered. They must be on disk in OpenCode's expected locations. The scaffolder is the installation mechanism; the plugin is the runtime glue.
- **Single config file** (`.hero/config.jsonc`) for all Hero-specific settings. OpenCode's own `opencode.json` is touched only for the plugin reference and `defaultMode`.
- **Issue board is GitHub Issues**, not local markdown. `gh` CLI is a runtime dependency for the custom tools.
- **Sandcastle is an optional integration** (`sandcastle.enabled` in config). Day-shift workflow (grill/PRD/kanban/TDD/review/verify) has zero Sandcastle/Docker dependency. Night-shift (`/ralph`) requires both.
- **OpenCode auth in Sandcastle** is passed via bind-mount of `~/.local/share/opencode` (readonly), not env-var injection. The model string is the only per-run parameter Sandcastle needs from Hero's config.
- **No streaming UX in AFK runs**: Sandcastle's OpenCode provider returns empty `parseStreamLine` results. Logs appear as complete chunks. Documented as a known limitation; PR #375 upstream may fix this.
- **SemVer discipline**: major version bumps require user to re-run `init --migrate`; minor/patch bumps auto-fill new config defaults on next `init`.

## Testing Decisions

### What makes a good test

Tests should only verify externally observable behaviour, not implementation details. For the plugin hooks, the observable behaviour is: which shell commands were spawned, which OpenCode API calls were made (`tui.toast.show`, `client.app.log`), and which tool calls were blocked or allowed. For the scaffolder, the observable behaviour is: which files were created, what they contain, how conflicts are handled.

### Modules to test

- **`plugin/config.ts`** — unit tests: valid config parses without error; missing required fields produce named Zod errors; unknown fields are ignored; JSONC comments parse correctly.
- **`plugin/hooks/guardrails.ts`** — unit tests: `.env` read is blocked; `.env.local` read is blocked; `.envrc` read is blocked; non-env read passes through; `git push --force` is blocked; `git push origin main` passes through.
- **`plugin/hooks/verify.ts`** — unit tests with a mocked `$`: verifies debounce prevents double-invocation; verifies skip when verify in-flight; verifies async (non-blocking) invocation.
- **`plugin/tools/pick-next-issue.ts`** and **`mark-issue-done.ts`** — unit tests with mocked `gh` output: correct label filtering; correct close command construction.
- **`bin/init.js`** — integration tests in a temp directory: first-run creates all expected files; second-run with unchanged files is a no-op; second-run with modified file refuses without `--force`; `--force` overwrites; `.hero-version` is written correctly; `opencode.json` is patched idempotently.
- **Plugin smoke test** — loads the plugin module in isolation and verifies it exports a valid plugin function that returns a hooks object without throwing.

### Test runner

Bun's built-in test runner (`bun test`). Mocking via Bun's `mock()` API.

## Out of Scope

- Node/JavaScript verify pipeline (stub only in `scripts/verify/node.sh`).
- Sand Castle parallel orchestration beyond what Sandcastle's `parallel-planner-with-review` template provides out of the box.
- Automated PR creation (Sandcastle handles branches; PR creation remains a manual `gh pr create`).
- Global/user-level Hero config (`~/.config/hero/`).
- Telemetry or usage analytics.
- `architecture-scan` as a programmatic custom tool (implemented as a Skill instead).
- Session resume / token-usage reporting in AFK runs (Sandcastle's OpenCode provider limitation).
- Native Windows support.
- Public npm registry publication.

## Further Notes

- **Source of workflow**: Matt Pocock's "Essential Skills for AI Coding from Planning to Production" talk (AI Engineer Europe, April 2026). Key concepts encoded: Grill Me alignment, PRD as destination doc, tracer-bullet vertical slices, smart zone / dumb zone, TDD red-green-refactor, deep modules, push vs pull standards, and the Ralph AFK loop.
- **Sandcastle dependency**: pinned to a known-working version in `bin/init.js`'s scaffolded files. Sandcastle API drift is a Hero release concern, not a runtime concern.
- **OpenCode auth bind-mount caveat**: init script will check whether `~/.local/share/opencode` exists and warn the user to run `opencode auth login` first if it does not.
- **Stack detection**: Python-first. Auto-detect triggers on presence of `pyproject.toml` or `requirements.txt`. Unknown stacks print a warning and a one-line `config.stack` override instruction. Node support documented as v2.
- **Token estimation**: labeled "approximate" in all user-facing output. Based on character-count heuristic (÷4), not a real tokenizer.
- **Sandcastle known limitations** (documented in README): no streaming UX in AFK runs, no session resume, no per-iteration token usage when using the OpenCode agent provider.
- **`to-prd` skill source**: this PRD was written following Matt Pocock's `to-prd` skill from `github.com/mattpocock/skills`, synthesised from the alignment session rather than interviewing the user again.
