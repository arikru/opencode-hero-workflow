---
name: hero-to-prd
description: Synthesise an alignment session into a structured PRD at .hero/prds/<slug>.md. Loaded when the user runs /prd.
---

# To PRD

You are synthesising the just-completed alignment session into a written PRD. The session may have been a `/grill`-driven dialogue, a freeform chat, or a Linear/Notion paste — work with whatever the user gave you.

## Output

Write a single file at `.hero/prds/<slug>.md` where `<slug>` is a kebab-case derivation of the project name (ask the user if the topic is ambiguous; do not guess silently). The file MUST contain these sections in this order:

1. `## Problem Statement` — one paragraph. The actual problem, not the proposed feature.
2. `## Solution` — one paragraph. Tracer-bullet description of what we're building.
3. `## User Stories` — numbered list. Each story in the form "As a <role>, I want <capability> so that <outcome>."
4. `## Implementation Decisions` — three subsections:
   - `### Modules to build` — bullet list with one-line description per module.
   - `### Key interfaces` — types/schemas/contract shapes that span modules.
   - `### Architectural decisions` — load-bearing trade-offs and why.
5. `## Testing Decisions` — what makes a good test for this product, what to test, what runner to use.
6. `## Out of Scope` — bullet list. Explicit non-goals.
7. `## Further Notes` — anything that didn't fit but the team will need.

## Discipline

- **Synthesise, don't transcribe.** Compress. The PRD reader should not need to read the alignment transcript.
- **Decisions, not options.** The PRD is a destination doc — by the time it's written, options have been picked. If something is genuinely open, list it under Further Notes as an open question, not as an unresolved branch in the body.
- **Vertical slices.** When the implementation section lists modules, prefer naming end-to-end slices over horizontal layers.
- **Concrete over abstract.** Every user story names a real human role and a real outcome.

## Process

1. Confirm the slug with the user before writing the file.
2. Check whether `.hero/prds/<slug>.md` already exists. If so, ask whether to overwrite or pick a new slug.
3. After writing, print the relative path so the user can open it.
4. Tell the user the next step is `/kanban` to break the PRD into vertical-slice GitHub issues.

## Reference

This skill is modelled on Matt Pocock's `to-prd` skill (https://github.com/mattpocock/skills). The on-disk Hero PRD (`prd.md` at the package root) is itself an example of the output shape — re-read it if your structure starts to drift.
