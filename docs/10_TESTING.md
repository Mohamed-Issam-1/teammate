# Testing Strategy

## Test pyramid

### Unit tests

Vitest, `tests/*.test.ts`, jsdom by default with an opt-in node environment for
server-boundary modules. Fast tests for:

- score calculations;
- state-transition rules;
- role/policy helpers;
- validation helpers;
- pure domain functions;
- the transactional email safety boundary, content builders, and the
  fail-closed configuration and database guards.

External provider, storage, and AI calls are always injected. No unit test
performs a network request, and `globalThis.fetch` is spied on to prove it.

### Integration tests

`npm run test:integration` runs a real PostgreSQL database, never a mock:

- create project;
- application acceptance transaction;
- invitation acceptance transaction;
- role/ownership transitions;
- authorization against real records;
- notification/activity creation.

Phase 1 currently covers registration, verification, sign-in/out, session and
account-status policy, rate limiting, password reset, onboarding invariants, and
the enumeration properties of the auth request boundary.

Mocks are acceptable for external email/storage/AI provider calls. The auth
integration suite injects an in-process email capture and never reaches a
provider.

### E2E

Playwright, Chromium, `npm run test:e2e`. Phase 1 covers:

1. sign up, observe the verification-required state, verify through the link,
   sign in, complete onboarding, reach the protected `/app` entry, sign out, and
   confirm `/app` is no longer reachable;
2. forgot-password request with neutral confirmation, reset through the link,
   confirmation that the old password is rejected, and confirmation that the new
   password works;
3. routing boundaries: unauthenticated `/onboarding` and `/app` redirect to
   `/sign-in`; a completed user is redirected from `/onboarding` to `/app`; an
   incomplete user is redirected from `/app` to `/onboarding`; sign-out
   invalidates access to both;
4. user-visible neutral copy for the request flows.

Planned for later phases:

5. complete profile;
6. create project;
7. second user applies;
8. owner accepts;
9. member opens workspace and task;
10. invitation path;
11. unauthorized user blocked from private workspace;
12. admin-only route protection;
13. AI suggestions display without changing membership.

Provider-failure enumeration is deliberately not exercised in the browser. It is
pinned by the unit and PostgreSQL integration suites, and reproducing it in a
browser would require a real provider call.

## E2E isolation

The end-to-end suite must never be able to reach the development database or a
real mailbox.

**Database.** `scripts/run-e2e-tests.ts` captures the real development URL as
`DEVELOPMENT_DATABASE_URL` and then repoints `DATABASE_URL` at the guarded test
database before starting anything. `assertSafeE2EDatabaseEnvironment` requires
an explicit end-to-end context marker, refuses the auth integration marker,
refuses `NODE_ENV=production`, and requires the test database name to end in
`_test`, to share the development host and port, and to differ from the
development database. Only `prisma migrate deploy` is ever run; rows are deleted,
never a schema. The application, the reset helper, and the Prisma migration child
each re-prove the guard independently.

**Email.** Messages are written by a test-only filesystem transport to a capture
file that must be an absolute path outside the repository. The directory is
created per run in the OS temp directory and removed on completion or on an
interrupt. The transport requires an explicit context marker and refuses
`NODE_ENV=production`; the selector checks `NODE_ENV === "production"` before it
is ever consulted, so no production-mode process can activate it. There is no
mailbox route, no debug endpoint, and no token logging.

**Server.** The suite runs `next dev` on a dedicated port bound to the loopback
host. Development mode is a deliberate choice: the production-mode server used
by `next start` would be unable to reach the test-only email transport at all,
which makes "test-only code is unreachable in production" a structural property
rather than an environment convention. The base URL uses `localhost` rather than
an IP address, because Next.js blocks cross-origin access to its own dev
resources and an IP address would prevent client hydration.

Known local caveat: the end-to-end server shares the repository `.next/`
directory with `npm run dev`, so avoid running both at once.

## Regression policy

A bug fix should include a regression test when practical.

## Test data

Prefer deterministic factories/builders over giant seed fixtures.

Never use production data. End-to-end identities are unique per invocation.

## Commands

```bash
npm run test            # unit (Vitest)
npm run test:watch
npm run test:integration # real PostgreSQL, guarded
npm run test:e2e         # Playwright, guarded
```

Release candidate verification:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
```

## CI scope

Hosted CI runs `npm ci`, `prisma validate`, `format:check`, `lint`, `typecheck`,
`test`, `build`, and a blocking `npm audit --audit-level=high`. The build uses
non-secret dummy auth values and requires no Resend credential.

`npm run test:integration` and `npm run test:e2e` are local gates. The PostgreSQL
suite is not in CI because the workflow deliberately has no database service.
The end-to-end suite is not in CI because it runs the application in development
mode, and a deterministic hosted equivalent would need a production-mode server
— which cannot reach the test-only email transport — or a redesign of the email
boundary. Neither is worth weakening the production reachability guarantee for.
Run both locally before a release.

## Coverage

Do not chase a meaningless percentage. High-risk domain/auth logic requires strong coverage even if UI coverage is lower.
