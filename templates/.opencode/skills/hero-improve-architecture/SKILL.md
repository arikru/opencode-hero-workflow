---
name: hero-improve-architecture
description: Scan the codebase for shallow-module clusters and propose deep-module consolidations. Loaded when the user runs /architecture-scan.
---

# Improve Architecture

You are auditing the codebase for John Ousterhout-style "shallow modules" and proposing consolidations into deeper ones.

## Definitions

- **Shallow module**: a module whose interface surface is large relative to the implementation it hides. Often a thin wrapper over another library, or a class with one method, or a "service" that just forwards calls.
- **Deep module**: a module with a small interface that hides substantial complexity. The user of the module gets leverage; the implementation can change without ripple.

The goal is to maximise hidden complexity per unit of exposed interface.

## How to scan

1. **Inventory modules.** Walk the package's source directories. For each module/file, note:
   - Lines of public interface (exported functions/types/classes — count signatures, not bodies).
   - Lines of internal implementation (everything else).
   - Number of call sites across the codebase (`grep` for the exported names).
2. **Compute the ratio** roughly: `public_interface_loc / internal_implementation_loc`. High ratio = shallow. Low ratio = deep.
3. **Look for clusters of shallows that share a domain.** A folder of `parser.ts`, `validator.ts`, `formatter.ts`, `serialiser.ts` each <30 lines often collapses into one cohesive module.
4. **Look for one-caller modules.** If a module has exactly one caller, it's almost always a candidate for inlining or merging.
5. **Look for facades over well-known libraries.** A `wrap-fetch.ts` that just renames `fetch` is shallow and adds no value.

## How to propose

For each consolidation, produce:

```
## <proposed deep module>

### What to merge
- <module path> (current LOC: <N>, callers: <M>)
- <module path> (current LOC: <N>, callers: <M>)

### Why deeper
<one paragraph: what complexity will be hidden, what interface stays exposed>

### Risk
<one paragraph: what would make this consolidation a mistake>

### Migration
<bulleted: minimal steps>
```

Then a top-level `## Summary` ranking by expected impact (lines saved, callers simplified, conceptual cohesion).

## Discipline

- **Do not refactor.** This skill is a proposal-writer, not an implementer. Propose, then stop.
- **Don't merge across domains.** A shallow auth module and a shallow billing module are still separate concerns.
- **Don't optimise for line count alone.** A 500-line module that hides genuine complexity is correct and should not be split.
- **Be honest about risk.** If a consolidation would hurt readability, say so. The PRD's instruction is "deep modules", not "fewest files".
- **Reference the source.** Pocock's deep-module guidance is from Ousterhout's *A Philosophy of Software Design*. If the user wants the rationale, name the source.
