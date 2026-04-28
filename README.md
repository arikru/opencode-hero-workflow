# opencode-hero-workflow

An opinionated OpenCode workflow scaffold that encodes Matt Pocock's "Essential Skills for AI Coding from Planning to Production" as a concrete set of slash commands, agent skills, plugin hooks, and an optional Sandcastle AFK runner. Install it once per project and you get a complete day-shift (human-in-the-loop) and night-shift (autonomous) pipeline driven from `.hero/config.jsonc`.

## What is Hero?

Hero is a distributable scaffold, not a framework. It installs file artifacts (slash commands, skills, scripts, templates) into your project's `.opencode/` and `.hero/` directories, plus a small OpenCode plugin that adds runtime hooks. There is no daemon, no service, no lock-in: deleting `.hero/` and removing the plugin reference from `opencode.json` reverts your project.

The workflow is structured around four habits drawn from Pocock's talk. Smart-zone discipline: keep the conversation under ~80K tokens and prefer `/clear` over compaction. Vertical-slice TDD: one issue, one tracer-bullet feature, red-green-refactor. Push-style code review: a fresh subagent context using a separate reviewer model audits diffs before they land. AFK runs via Sandcastle: when you stop typing, `/ralph` keeps picking ready issues and implementing them.

The split between day-shift and night-shift is deliberate. Day-shift is interactive: you are the planner, the agent is the implementer, and slash commands drive the loop. Night-shift removes you from the loop entirely; the agent picks issues from a GitHub board, runs the same TDD discipline inside a sandbox, and surfaces results when you come back.

## Install

### OpenCode

```sh
bunx opencode-hero-workflow@latest init
```

### Claude Code

Hero skills are also available as a Claude Code plugin. This gives you the skills (`/hero:grill-me`, `/hero:tdd-loop`, etc.) but not the runtime hooks, verify loop, or token-budget toasts — those are OpenCode-only.

**Install per session:**

```sh
claude --plugin-dir /path/to/opencode-hero-workflow/.opencode
```

**Install per project (via git):**

Add to your project's `.claude/settings.json`:

```json
{
  "plugins": ["gh:arikru/opencode-hero-workflow/.opencode"]
}
```

**Available skills:**

| Skill | Invocation |
| --- | --- |
| Grill / alignment | `/hero:grill-me` |
| TDD loop | `/hero:tdd-loop` |
| Kanban breakdown | `/hero:kanban` |
| Architecture scan | `/hero:improve-architecture` |
| Code review | `/hero:reviewer-standards` |
| Dogfood | `/hero:dogfood` |
| PRD | `/hero:to-prd` |

---

The default install mode is global (`~/.config/opencode`). The `init` flow prompts for the three model roles (`implementer`, `reviewer`, `planner`) so you can pick any OpenCode-supported provider, e.g. `github-copilot/claude-sonnet-4.5`. It writes:

- `~/.config/opencode/hero/config.jsonc` and `~/.config/opencode/hero/.hero-version`.
- `~/.config/opencode/skills/**` (all Hero skills, namespaced under `hero-*`).
- `~/.config/opencode/opencode.json` updates:
  - `plugin` includes `opencode-hero-workflow`.
  - `command` includes all `hero:*` skill commands (global command aliases).

Re-run with `--migrate` to pull in new defaults during a compatible upgrade without clobbering customisations. Use `--force` only after reviewing the diff: it overrides the SHA-256 content-hash conflict refusal that protects files you have edited locally.

### `hero:*` global commands

Global install adds these command aliases to `~/.config/opencode/opencode.json`:

| Command | What it does |
| --- | --- |
| `hero:grill-me` | Load the `hero-grill` skill and start an alignment session on the user-provided topic. |
| `hero:tdd-loop` | Load the `hero-tdd-loop` skill and run a red-green-refactor loop for the selected GitHub issue. |
| `hero:kanban` | Load the `hero-kanban` skill and break the current plan or PRD into vertical-slice GitHub issues. |
| `hero:improve-architecture` | Load the `hero-improve-architecture` skill and scan the codebase for deepening opportunities. |
| `hero:reviewer-standards` | Load the `hero-reviewer-standards` skill and audit the diff with push-style review standards. |
| `hero:dogfood` | Load the `hero-dogfood` skill and run a happy-path to adversarial dogfooding session. |
| `hero:to-prd` | Load the `hero-to-prd` skill and turn the current context into a PRD GitHub issue. |

## Configuration

Hero loads config in two layers:

1. Global base config from `~/.config/opencode/hero/config.jsonc`.
2. Optional project-local override from `<project>/.hero/config.jsonc`.

The plugin deep-merges local over global, then validates the result with Zod at startup; malformed fields surface named path errors before hooks load. The schema at `schemas/hero-schema.json` powers editor autocomplete via `$schema`.

Configurable areas:

- `models.{implementer,reviewer,planner}` — provider/model strings, e.g. `github-copilot/claude-sonnet-4.5`.
- `stack` — `python` (default if `pyproject.toml` or `requirements.txt` is detected), `node` (v2 stub), or `auto`.
- `verify.{enabled,debounceMs,commands}` — post-edit verification kill switch and tuning.
- `tokenBudget.{warnAt,alarmAt}` — smart-zone toast thresholds (defaults 80000 / 100000).
- `guardrails.{blockEnvReads,blockForcePush}` — security guardrails, both default `true`.
- `github.{repo,labels.{ready,inProgress,blocked}}` — issue board configuration, label scheme defaults to `hero:ready` / `hero:in-progress` / `hero:blocked`.
- `sandcastle.{enabled,imageName,maxIterations,idleTimeoutSeconds,mountOpencodeAuth}` — night-shift orchestrator settings, disabled by default.

### Local project overrides

Create `<project>/.hero/config.jsonc` when a repo needs different behavior than your global defaults (for example: different models, repo labels, verify tuning, or Sandcastle settings).

Minimal override example:

```jsonc
{
  "$schema": "./node_modules/opencode-hero-workflow/schemas/hero-schema.json",
  "models": {
    "implementer": "github-copilot/claude-sonnet-4.5",
    "reviewer": "github-copilot/claude-opus-4-7",
    "planner": "github-copilot/claude-sonnet-4.5"
  },
  "verify": {
    "debounceMs": 2000
  }
}
```

You can override any top-level schema key (`version`, `models`, `stack`, `verify`, `tokenBudget`, `guardrails`, `github`, `sandcastle`), including nested fields.

## Day-shift commands

The day-shift loop is align then PRD then kanban then tdd then review. Each step is a slash command that loads a corresponding skill. You can break out of the loop at any point — the commands are independent, but the order is the recommended path for a new feature.

| Command | What it does |
| --- | --- |
| `/grill <topic>` | Relentless interview about a plan until every branch of the decision tree is resolved. |
| `/dogfood [seed]` | Exercise a feature as a real user — happy-path → adversarial → source read → HTML report. |
| `/prd` | Synthesise the current context into a PRD and submit it as a GitHub issue. |
| `/kanban [issue-number-or-url]` | Break a plan or PRD into independently-grabbable vertical-slice GitHub issues. |
| `/pick-task` | Select the highest-priority unblocked `hero:ready` issue. |
| `/tdd <issue-number>` | Drive red-green-refactor on the chosen issue. |
| `/verify` | Run the project's verify suite and interpret the result. |
| `/review <pr-or-branch>` | Fresh-context audit using the reviewer model. |
| `/architecture-scan` | Propose deep-module consolidations for shallow clusters. |
| `/context-status` | Approximate token usage and smart-zone reminder. |
| `/mark-issue-done` | Close the active issue with a completion comment. |

## Dogfooding: /dogfood

`/dogfood [seed]` loads the `hero-dogfood` skill and runs a structured session that exercises a feature or codebase as a real user would, then grounds every observation in source code, and emits an HTML report of findings.

**Phases:**

1. **Happy-path** — confirm the primary success scenario works end-to-end.
2. **Adversarial** — probe edge cases, bad inputs, and failure modes systematically.
3. **Source reading** — read the relevant source with the grounding of live probes to explain root causes.
4. **Report** — emit a structured HTML report generated by `.opencode/skills/hero-dogfood/scripts/render_report.py`, saved to `.opencode/dogfood/`. The `.opencode/skills/hero-dogfood/assets/report-template.html` file is a static preview reference.

**Seed discovery** (in priority order): user-supplied seed → README/quickstart → existing test files → CLI `--help` / API surface scan. If the seed is ambiguous the agent states its scope and continues unless you object.

**Safe mode (default):** only side-effect-free operations — reading files, running tests, calling pure functions, GET-style probes, throwaway temp directories. No mutations, no network writes.

**Dangerous mode:** add `dangerous mode`, `allow side effects`, or `allow mutations` to the invocation. Destructive operations still require an explicit per-action confirmation before they run.

The session continues adversarial probing until two consecutive probes yield no novel finding, or 20 total probes have been executed. Each finding is captured immediately in a structured YAML block (severity, what was tried, what happened, what was expected, evidence, suggested next step).

---

## Night-shift: /ralph (AFK Sandcastle)

When `sandcastle.enabled` is `true` in `.hero/config.jsonc`, `/ralph` launches a Sandcastle-orchestrated AFK run. The runner picks `hero:ready` issues from the GitHub board, implements each one through the `hero-tdd-loop` skill, runs `hero-reviewer-standards` against the resulting diff, and leaves a branch ready for a manual `gh pr create`. Iteration boundaries and exit status are logged; per-iteration token usage is not available when using the OpenCode agent provider.

Pre-flight checks before `/ralph` will run: the `sandcastle` binary must be on `PATH`, `.sandcastle/` must be scaffolded (`init` does this when you opt in), and `~/.local/share/opencode` must exist on the host. Sandcastle bind-mounts that directory readonly into the sandbox so any provider — including GitHub Copilot — authenticates inside the AFK run. If the directory is missing, run `opencode auth login` on the host first.

## Stack support

Python is the supported stack today: Hero's verify runner resolves `scripts/verify.sh` from the project when present, otherwise falls back to the bundled package script; the Python path runs `ruff check`, `mypy` (when configured), and `pytest -x --tb=short`. Node verify exists only as a v2 stub. Auto-detection runs against `pyproject.toml`, `requirements.txt`, and `package.json`; you can override the choice by setting `HERO_STACK=python` in the environment or by pinning `stack` in config. Unknown stacks soft-exit with a one-line override pointer rather than breaking your session.

## Hooks the plugin installs

The plugin registers the following runtime hooks with OpenCode at startup:

- Guardrails: blocks reads of `.env*` files and `git push --force` (configurable via `guardrails.*`).
- Post-edit verify: spawns Hero's verify runner async after `edit`/`write` tool calls, debounced per `verify.debounceMs`.
- Token-budget toasts at the `tokenBudget.warnAt` and `tokenBudget.alarmAt` thresholds.
- Compaction warning on `session.compacted`, plus minimal continuation-context injection (current PRD path and active issue) so the agent recovers gracefully if compaction does happen.
- Startup version-drift toast when `.hero/.hero-version` lags the installed package version, with a one-line `init --migrate` fix.

## Known limitations

- **Sandcastle**: no streaming UX during AFK runs (logs appear as chunks); no session resume; no per-iteration token usage when using the OpenCode agent provider. Tracked upstream.
- **Token estimation**: heuristic (character-count divided by four), labelled "approximate" everywhere it surfaces.
- **Windows**: not a target. Native Linux and macOS only.

## Uninstall

Run:

```sh
hero-init --uninstall
```

Uninstall is global-only and removes Hero-managed files from `~/.config/opencode` based on the install manifest, then removes Hero plugin and `hero:*` command entries from `~/.config/opencode/opencode.json`.

It does not remove:

- Files you modified after install (these are skipped for safety).
- Project-local runtime state such as `<project>/.hero/state.json`.

## Upgrading

Re-run `bunx opencode-hero-workflow@latest init --migrate` to pull in new defaults from a compatible release without overwriting files you have customised. The scaffolder uses a SHA-256 content-hash manifest to detect drift and refuses to clobber edited files; pass `--force` only when you have reviewed the diff and want to reset. If you prefer pinned installs, use an explicit package version (for example `bunx opencode-hero-workflow@0.2.1 init`). Major-version bumps may require a manual migration step; consult the CHANGELOG for the target version once one exists.

### Cutting a release (maintainers)

Releases are published to npm by a tag-driven GitHub Actions workflow (`.github/workflows/publish.yml`). To cut one:

1. Bump `version` in `package.json` and merge to `main`.
2. Wait for the `CI` workflow on `main` to go green (it runs `bun test` and `bun run build:schema`).
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Watch the `Publish` workflow. It re-runs the tests, verifies the tag matches `package.json`, refuses to re-publish a version already on npm, then runs `npm publish --access public`.

If a publish fails after the tag is pushed, fix the underlying issue, bump to the next patch version, and tag again. Do not force-push tags or attempt to re-publish the same version — the guard in the workflow will reject it.

## Contributing

The package is developed using its own workflow. The day-shift slash commands work in this repo (`/grill`, `/prd`, `/kanban`, `/tdd`, `/verify`, `/review`), and `/ralph` is available if you set `sandcastle.enabled: true` in your local `.hero/config.jsonc`. Pull requests welcome through the standard GitHub PR flow.

## Credits

The workflow and skills in this scaffold are based on Matt Pocock's talk and transcript **"Essential Skills for AI Coding from Planning to Production"**:

- Video: [https://www.youtube.com/watch?v=-QFHIoCo-Ko&list=PLgWBLnrVaSruEA5HL8Yw0MNRfVmiuDhgJ](https://www.youtube.com/watch?v=-QFHIoCo-Ko&list=PLgWBLnrVaSruEA5HL8Yw0MNRfVmiuDhgJ)
- Transcript: [https://raw.githubusercontent.com/stewdotorg/ai-swe/main/matt-pocock-ai-coding-workflow-summary.md](https://raw.githubusercontent.com/stewdotorg/ai-swe/main/matt-pocock-ai-coding-workflow-summary.md)
