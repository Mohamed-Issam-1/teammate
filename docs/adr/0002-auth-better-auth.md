# ADR-0002 — Better Auth for Authentication

Status: Accepted

## Context

TeamMate requires email/password, verification, reset flows, database sessions, and a maintainable Next.js integration.

Auth.js remains usable, but its current project guidance recommends Better Auth for new projects unless a specific Auth.js capability is required.

## Decision

Use Better Auth with Prisma/PostgreSQL persistence.

Authorization remains TeamMate-owned domain logic and is not delegated to the authentication library.

## Consequences

- auth framework tables/schema must be generated/reviewed carefully;
- project authorization helpers remain separate;
- email verification/reset provider integration is required;
- future OAuth/passkey support can be added without replacing domain authorization.
