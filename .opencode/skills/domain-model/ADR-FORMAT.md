# ADR Format

An Architecture Decision Record (ADR) documents a significant architectural decision: what was decided, why, and what alternatives were rejected. ADRs let future explorers avoid re-litigating settled questions.

## File location

- Project-wide: `docs/adr/ADR-NNNN-<slug>.md`
- Context-scoped (multi-context repo): `<context-dir>/docs/adr/ADR-NNNN-<slug>.md`

Use four-digit zero-padded numbers (`ADR-0001`, `ADR-0042`).

## Template

```markdown
# ADR-NNNN: <Title>

**Status:** proposed | accepted | deprecated | superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Deciders:** <names or roles>

## Context

<What situation or constraint forced this decision? What was the problem space?>

## Decision

<What was decided, stated plainly. One paragraph.>

## Consequences

**Positive:**
- <benefit>

**Negative / trade-offs:**
- <cost or constraint this decision imposes>

## Alternatives considered

### <Alternative A>
<Why it was rejected.>

### <Alternative B>
<Why it was rejected.>
```

## Rules

- **One decision per ADR.** If you find yourself writing "and also," split the record.
- **Write in past tense.** "We decided to…" not "We will…"
- **Record the rejection reasons.** The alternatives section is the most valuable part for future explorers.
- **Update status, do not delete.** When a decision is reversed, mark it `superseded by ADR-XXXX` and create the new ADR. Deleted history misleads.
- **Offer an ADR sparingly.** Only record decisions with load-bearing reasons — ones a future architecture review would need to avoid re-suggesting the same thing. Skip ephemeral reasons ("not worth it right now") and self-evident ones.
