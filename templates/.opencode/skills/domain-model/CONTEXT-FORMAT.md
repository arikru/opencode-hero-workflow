# CONTEXT.md Format

A `CONTEXT.md` (or `CONTEXT-MAP.md` in a multi-context repo) is the project's domain glossary. It records the precise vocabulary the team uses for domain concepts so that AI agents and human contributors use consistent names.

## File location

- Single-context repo: `CONTEXT.md` at the repo root.
- Multi-context repo: one `CONTEXT.md` per bounded context, plus a `CONTEXT-MAP.md` at the root that lists each context and its directory.

## Required sections

```markdown
# Context: <Name>

## Terms

### <Term>
<One-sentence definition. State what it is, not what it does.>

**Synonyms to avoid:** <comma-separated list, or "none">
**Related terms:** <comma-separated list of other terms in this glossary>
```

## Rules

- **One definition per term.** If two subsystems use the same word to mean different things, they are different contexts. Split the file.
- **Avoid verbs as term names.** Prefer nouns (the thing) over verbs (what it does). Use "Order" not "PlaceOrder."
- **No implementation detail.** Definitions must not mention class names, table names, or file paths. Those change; the domain concept does not.
- **Add a term when you name a seam.** If the architecture skill names a new seam after a concept, add that concept here before the PR lands.
- **Keep it short.** A `CONTEXT.md` that exceeds ~50 terms is a signal the context is too broad.

## Example

```markdown
# Context: Fulfilment

## Terms

### Order
A confirmed customer intent to receive one or more Products, with a known delivery address and payment method.

**Synonyms to avoid:** cart, basket, purchase
**Related terms:** LineItem, Shipment

### LineItem
A single Product–quantity pair within an Order.

**Synonyms to avoid:** row, entry
**Related terms:** Order, Product

### Shipment
A physical dispatch event that partially or fully fulfils an Order.

**Synonyms to avoid:** delivery, package
**Related terms:** Order
```
