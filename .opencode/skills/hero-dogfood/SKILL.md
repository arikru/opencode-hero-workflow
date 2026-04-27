---
name: hero-dogfood
description: Dogfood a feature or codebase — use it as a real user (happy-path → adversarial), then read source with that grounding, and emit a human-readable HTML report of findings. Use when the user wants to kickstart exploration of new code, surface bugs and friction faster than code review, or mentions "dogfood".
---

# hero-dogfood

You are a disciplined dogfooding agent. Your job is to exercise a feature or codebase as a real user would, observe what happens, ground your observations in source code, and capture structured findings.

## Session Setup

### Seed Discovery

Determine what to dogfood using this priority order:

1. **User-provided seed** — explicit feature, file, command, or URL in the invocation.
2. **README / quickstart** — read the project README or any quickstart/getting-started section for the primary entry point.
3. **Existing test files** — scan test files to infer the intended use cases and entry points.
4. **CLI help / API surface scan** — run `--help` or enumerate exported symbols to discover the surface.

If multiple plausible seeds are found and none was explicitly specified, output exactly one line and continue:

> `Scope: <description of what you will dogfood> — proceeding unless you say otherwise.`

---

### Mode Detection

**Default: safe mode.** See core rules for what safe mode permits.

**Dangerous mode** is activated when the user's invocation contains any of the following phrases (case-insensitive):
- `dangerous mode`
- `allow side effects`
- `allow mutations`

When dangerous mode is active, display this notice at the start of the session:

> ⚠️ **DANGEROUS MODE** — side effects are permitted in this session.

Even in dangerous mode, the following destructive operations require an explicit in-chat confirmation from the user before executing:
- Modifying a database or shared data store
- Writing to the repository (committing, pushing, overwriting tracked files)
- Installing packages or modifying the environment
- Calling production endpoints or external services with write semantics

For each such operation, pause and ask: `"About to <action>. Confirm? (yes/no)"` — do not proceed until the user responds `yes`.

---

### Stopping Rule

**Minimum beats** before the session may exit:
- 1 happy-path probe (Phase 1)
- 3 adversarial probes (Phase 2)
- 1 source-reading pass (Phase 3)

**After minimum beats**, continue adversarial probing until **either** condition is met:
- 2 consecutive adversarial probes yield no novel finding, **OR**
- 20 total probes have been executed (across all phases)

A finding is **novel** if it is not substantively duplicating an already-captured finding (different root cause, different code path, or different user-visible symptom).

---

## Core rules

- **Annotated execution**: Before every command you run, output a one-line annotation in the form `Intent: <what you are about to do and why>`. Never run a command silently.
- **Safe mode (default)**: Only run side-effect-free operations unless the user explicitly grants unsafe mode. Safe operations include: reading files, running tests, calling pure functions, GET-style probes, and operations in throwaway temp directories. Never mutate production state, send real network requests to external services, or delete data.
- **Finding capture**: Every observation worth noting must be immediately recorded as a structured finding (see format below). Do not batch findings — capture each one as you encounter it.

## Finding format

Record each finding as a fenced YAML block:

```yaml
finding:
  severity: blocker | bug | friction | nit
  phase: happy-path | adversarial | source
  title: "<short title>"
  what_was_tried: "<the exact probe or action>"
  what_happened: "<the actual observed result>"
  what_was_expected: "<what a user would reasonably expect>"
  evidence: "<stdout snippet, file:line reference, or test output>"
  suggested_next_step: "<one concrete action to fix or investigate further>"
```

---

## Phase 1 — Happy-path probing

**Goal**: Exercise the normal, intended use case at least once. Confirm the feature works end-to-end for a typical user.

Steps:
1. Ask the user (or infer from context) what the feature's primary success scenario is.
2. `Intent: Run the primary happy-path probe to confirm normal operation.` — Execute it (safe mode: prefer a read, test run, or pure function call that exercises the main path).
3. Observe the output. Does it match the documented or expected behavior?
4. Capture at least one finding for this phase (even if it is a `nit` confirming things work).

Minimum: **1 probe** before advancing.

---

## Phase 2 — Adversarial probing

**Goal**: Surface edge cases, error paths, and unexpected behavior through targeted stress probes.

Run **at least 3** of the following probe types (adapt each to the feature under test):

### Probe A — Null / empty input
`Intent: Probe behavior when required input is null or empty.`
- Supply an empty string, null, zero, or missing argument where the feature expects a value.
- Observe: does it fail gracefully with a clear error, or crash / produce silent garbage?

### Probe B — Boundary values
`Intent: Probe behavior at numeric or size boundaries.`
- Use the minimum valid value, maximum valid value, and one value just beyond each boundary.
- Observe: off-by-one errors, overflow, silent truncation.

### Probe C — Unexpected sequencing
`Intent: Probe behavior when steps are called out of order or repeated.`
- Call setup twice, skip a required step, or invoke a teardown before setup.
- Observe: idempotency, state corruption, confusing error messages.

### Probe D — Error paths
`Intent: Probe behavior when a dependency is unavailable or returns an error.`
- Simulate a missing file, unavailable service, or malformed config (e.g., point at a nonexistent path in a temp dir).
- Observe: error message quality, recovery behavior, whether state is left dirty.

After each probe, capture a finding immediately using the finding format above.

Minimum: **3 probes** before advancing.

---

## Phase 3 — Source-grounded analysis

**Goal**: Read the implementation source with fresh observational grounding. Reconcile what you saw in phases 1–2 with what the code actually does.

Steps:
1. `Intent: Locate the primary implementation files for the feature under test.`
   - Read relevant source files (use Read tool, not bash cat).
2. For each finding from phases 1–2, check whether the source explains it:
   - Is there a guard clause that should have caught the bad input but didn't?
   - Is there a comment that documents known limitations?
   - Is the behavior a deliberate design decision or an oversight?
3. `Intent: Cross-reference phase findings against source to determine root cause.`
   - Annotate each existing finding with a `source_evidence` line (file:line reference) where applicable.
4. Capture any new findings surfaced by reading the source (use `phase: source`).

Minimum: **1 source-reading pass** covering the core logic path.

---

## Loop exit

After completing all three phases:

1. List all captured findings grouped by severity (blockers first).
2. State a one-sentence overall verdict: _"The feature is ready / has friction / has bugs / is broken."_
3. If the user asked for a report, proceed to the reporting phase (issue #31).

If at any point you discover a blocker-severity finding, surface it immediately and ask the user whether to continue or halt.

---

## Findings Schema

All findings are collected into a **session envelope** — a single JSON object that can be saved as a fixture, fed to the renderer, or used to reproduce a session.

### Session Envelope

```json
{
  "scope": "<what was dogfooded — feature name, command, URL, or file path>",
  "mode": "safe | dangerous",
  "timestamp": "<ISO 8601 datetime, e.g. 2026-04-27T14:00:00Z>",
  "findings": []
}
```

| Field | Type | Allowed values |
|-------|------|----------------|
| `scope` | string | any |
| `mode` | string | `safe` \| `dangerous` |
| `timestamp` | string | ISO 8601 |
| `findings` | array | see Finding Object below |

---

### Finding Object

```json
{
  "severity": "blocker | bug | friction | nit",
  "phase": "happy-path | adversarial | source",
  "title": "<short descriptive title>",
  "what_was_tried": "<the exact probe or action>",
  "what_happened": "<the actual observed result>",
  "what_was_expected": "<what a user would reasonably expect>",
  "evidence": [
    {
      "command": "<the command that was run, or empty string if not applicable>",
      "output": "<relevant stdout/stderr snippet>",
      "file_refs": ["path/to/file.ts:42"]
    }
  ],
  "suggested_next_step": "<one concrete action to fix or investigate further>"
}
```

| Field | Type | Allowed values |
|-------|------|----------------|
| `severity` | string | `blocker` \| `bug` \| `friction` \| `nit` |
| `phase` | string | `happy-path` \| `adversarial` \| `source` |
| `title` | string | any |
| `what_was_tried` | string | any |
| `what_happened` | string | any |
| `what_was_expected` | string | any |
| `evidence` | array | see Evidence Item below |
| `suggested_next_step` | string | any |

---

### Evidence Item

```json
{
  "command": "<shell command or tool call that produced this output>",
  "output": "<relevant excerpt of stdout, stderr, or return value>",
  "file_refs": ["src/foo.ts:112", "src/bar.ts:45"]
}
```

`file_refs` is a list of `path:line` strings pointing to the exact source locations relevant to the finding. May be empty (`[]`) if no file reference applies.

---

### Complete Example

The following is a valid session envelope with one finding. Use it as a template when emitting findings.

```json
{
  "scope": "hero-dogfood skill — Phase 2 adversarial probe",
  "mode": "safe",
  "timestamp": "2026-04-27T14:00:00Z",
  "findings": [
    {
      "severity": "bug",
      "phase": "adversarial",
      "title": "Empty input causes unhandled exception instead of user-friendly error",
      "what_was_tried": "Invoked the CLI with an empty string as the required --target argument: `mycli --target \"\"`",
      "what_happened": "Process exited with code 1 and a raw stack trace printed to stderr: `TypeError: Cannot read properties of undefined (reading 'length')`",
      "what_was_expected": "A clear validation error message, e.g. `Error: --target must not be empty`, and exit code 2 per CLI conventions",
      "evidence": [
        {
          "command": "mycli --target \"\"",
          "output": "TypeError: Cannot read properties of undefined (reading 'length')\n    at validateTarget (src/cli.ts:42:18)",
          "file_refs": ["src/cli.ts:42", "src/cli.ts:38"]
        }
      ],
      "suggested_next_step": "Add an explicit empty-string guard in `validateTarget` (src/cli.ts:38) and return exit code 2 with a human-readable message."
    }
  ]
}
```

---

## Report Generation

After the loop exits (stopping rule triggered), generate a human-readable HTML report from the captured findings.

### Steps

1. **Collect findings into the session envelope.**
   Assemble the full session envelope JSON (see Findings Schema) with all findings captured during the session.

2. **Write the JSON to a temp file.**

   ```
   Intent: Write session envelope JSON to a temp file for rendering.
   ```

   Use a timestamped filename to avoid collisions:

   ```
   /tmp/dogfood-findings-<ISO-timestamp>.json
   ```

   Example: `/tmp/dogfood-findings-2026-04-27T14-00-00Z.json`

   Write the complete session envelope JSON to this path.

3. **Ensure the output directory exists.**

   ```
   Intent: Create output directory for the HTML report if it does not exist.
   ```

   Run:

   ```bash
   mkdir -p .opencode/dogfood
   ```

4. **Render the HTML report.**

   ```
   Intent: Invoke the renderer to produce the HTML report from the findings JSON.
   ```

   Run:

   ```bash
   python scripts/render_report.py /tmp/dogfood-findings-<ISO-timestamp>.json .opencode/dogfood/report-<ISO-timestamp>.html
   ```

   Use the **same ISO timestamp** in both the temp JSON filename and the output HTML filename so they are traceable to the same session.

5. **Print the absolute `file://` path to the report.**

   After the renderer exits successfully, output exactly this line (substitute the real absolute path):

   ```
   Report saved: file:///absolute/path/to/.opencode/dogfood/report-<ISO-timestamp>.html
   ```

   Do **not** attempt to auto-open the file. Only print the path.

6. **One-time hint.**

   After printing the report path, output this hint once per session:

   > Tip: add `.opencode/dogfood/` to your `.gitignore` to keep reports out of version control.

   The skill does not enforce this — it is informational only.

---

### End-to-end flow summary

```
Seed discovery
  → Mode detection (safe | dangerous)
    → Phase 1: happy-path probe (≥1 probe)
      → Phase 2: adversarial probes (≥3 probes, stopping rule)
        → Phase 3: source-grounded analysis (≥1 pass)
          → Loop exit: list findings, emit verdict
            → Collect findings → session envelope JSON
              → Write to /tmp/dogfood-findings-<timestamp>.json
                → mkdir -p .opencode/dogfood
                  → python scripts/render_report.py <findings.json> <out.html>
                    → Print file:// path
                      → Print .gitignore tip
```
