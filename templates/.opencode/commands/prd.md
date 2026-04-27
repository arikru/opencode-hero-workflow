---
description: Synthesise the current alignment session into a PRD at .hero/prds/<slug>.md
---

Load the `hero-to-prd` skill and write a PRD for the topic the user just aligned on.

If the user has not yet run `/grill`, ask whether to proceed anyway (some PRDs are obvious enough not to need an alignment ritual). If they confirm, proceed.

Confirm the slug before writing. After writing, print the relative path and recommend `/kanban` as the next step.
