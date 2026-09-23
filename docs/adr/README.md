# Architecture Decision Records

Use ADRs for decisions with meaningful long-term consequences.

Naming:

```text
0001-short-decision-name.md
0002-next-decision.md
```

Template:

```md
# ADR-NNNN — Title

Status: Proposed | Accepted | Superseded

## Context
What problem/constraint caused the decision?

## Decision
What will we do?

## Alternatives considered
What else was considered?

## Consequences
Benefits, costs, risks, migration impact.

## Follow-up
Required implementation/docs work.
```

After accepting an ADR, update `00_SOURCE_OF_TRUTH.md` if the canonical architecture changes.
