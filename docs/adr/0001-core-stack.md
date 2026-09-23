# ADR-0001 — Core Application Stack

Status: Accepted

## Context

TeamMate must demonstrate production-oriented full-stack engineering while remaining feasible for one developer assisted by coding agents.

## Decision

Use:
- Next.js App Router + TypeScript;
- PostgreSQL;
- Prisma 7 stable;
- Tailwind + shadcn/ui;
- Docker for local PostgreSQL/Redis;
- Vercel for the initial deployment model.

Use a modular monolith rather than separate frontend/backend services.

## Alternatives considered

### Next.js + separate Laravel API
Good portfolio breadth, but increases auth, API contract, deployment, CORS, testing, and operational work.

### Microservices
Rejected for initial scope because complexity is not justified.

## Consequences

Benefits:
- one deployment unit;
- strong full-stack TypeScript path;
- lower operational overhead;
- easier vertical-slice delivery.

Costs:
- backend and frontend scale together initially;
- careful server/client boundary discipline is required.
