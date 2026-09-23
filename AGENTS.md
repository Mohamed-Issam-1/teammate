# TeamMate — Agent Instructions

## 1. Mandatory context

Before substantial work, read:

1. `docs/00_SOURCE_OF_TRUTH.md`
2. `docs/STATUS.md`
3. `docs/13_ROADMAP.md`
4. the feature-specific document(s) relevant to the task

The Source of Truth is authoritative. Do not silently invent requirements that conflict with it.

## 2. Work scope

- Work on one phase or one well-defined feature at a time.
- Do not implement later roadmap phases unless explicitly requested.
- Inspect existing code before editing.
- Reuse existing components, schemas, services, and patterns before creating new abstractions.
- Avoid speculative abstractions. Add an abstraction when it represents a real domain boundary, security boundary, or repeated pattern.
- Keep routing files thin. Business rules belong in server/domain modules, not page components.
- Do not perform unrelated refactors while implementing a feature.

## 3. Architecture rules

- Next.js App Router.
- Strict TypeScript. Do not use `any` unless a third-party boundary makes it unavoidable and the exception is documented.
- Validate all external/user input with Zod at the server boundary.
- Authentication is not authorization. Perform resource-level authorization server-side for every protected mutation/read.
- Prefer Server Components by default; use Client Components only where interactivity requires them.
- Use Server Actions for UI-coupled mutations when appropriate.
- Use Route Handlers for webhooks, auth handlers, upload signing, AI endpoints, and externally consumable HTTP endpoints.
- TanStack Query is for client-side async state that benefits from caching/refetching; do not wrap every server query in it.
- Database access must remain server-only.
- Multi-write business operations must use transactions when partial completion would create invalid state.
- Store timestamps in UTC.
- Paginate list endpoints and queries; never fetch unbounded user/project/task lists.
- Files go to object storage; only metadata/ownership belongs in PostgreSQL.

## 4. Authentication and security

- Use Better Auth as defined by the architecture documents.
- Never trust role, user ID, project ID, team ID, price/limit, or permission values supplied by the client without server verification.
- Never expose secrets to `NEXT_PUBLIC_*`.
- Never log passwords, auth tokens, reset tokens, verification tokens, raw session cookies, API keys, or secrets.
- Apply rate limiting to auth-sensitive, invitation, upload, and AI endpoints before production release.
- Validate file type, size, and ownership on the server.
- Treat AI output as untrusted data.
- The AI matching feature may recommend; it must not autonomously join, remove, invite, or reject users.

## 5. Database safety

Never run or suggest executing destructive database operations without explicit user approval.

Forbidden by default:

- `prisma migrate reset`
- force reset / force push operations
- dropping the database/schema
- deleting migrations to “fix” history
- destructive SQL against non-ephemeral data

Prefer additive, reviewable migrations.

## 6. Git safety

Do not commit or push unless explicitly asked.

Never run:

- `git push` without explicit approval
- `git reset --hard`
- `git clean -fd`
- force push
- history rewriting

Use `git status`, `git diff`, and `git log` freely for inspection.

## 7. Quality gates

For relevant changes, run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run focused tests during development. Run E2E tests for critical user flows when they exist.

A feature is not complete merely because the UI renders. It must satisfy the relevant acceptance criteria, authorization rules, validation, error states, tests, and documentation requirements.

## 8. Testing expectations

- Business rules: unit tests.
- Database/service boundaries: integration tests where valuable.
- Critical flows: Playwright E2E.
- Every bug fix should add a regression test when practical.
- Tests must assert behavior, not implementation details.

Critical flows include authentication, project application/invitation decisions, membership/role changes, protected mutations, uploads, and AI suggestion authorization/cost controls.

## 9. UI/UX expectations

- Responsive from mobile to desktop.
- Accessible labels, keyboard behavior, focus handling, semantic structure, and sufficient contrast.
- Every async screen must account for loading, empty, success, error, and permission-denied states where applicable.
- Reuse the design system; do not create one-off visual patterns without need.
- Dark/light mode must use semantic tokens rather than duplicated hard-coded colors.

## 10. Documentation discipline

When a change affects architecture, domain behavior, security, data model, APIs, or deployment:

- update the relevant document;
- update `docs/00_SOURCE_OF_TRUTH.md` if the canonical decision changed;
- create/update an ADR for significant architectural decisions;
- update `docs/STATUS.md` after completing a roadmap item.

Documentation must describe current behavior, not aspirational behavior, unless explicitly marked as planned.

## 11. Completion report

At the end of a substantial task, report:

- what changed;
- files changed;
- tests/verification run and results;
- migrations/environment changes;
- risks or known gaps;
- documentation updated;
- what remains in the current phase.

Do not claim a command passed unless it was actually run successfully.
