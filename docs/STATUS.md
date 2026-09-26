# Project Status

## Current phase

**Phase 1 — Authentication and onboarding**

Status: Phase 1 code complete. All local quality gates pass, hosted GitHub
Actions CI is green on `main`, and the PostgreSQL integration and Playwright
end-to-end suites pass locally. Live production email delivery remains externally
unverified (see "External configuration still pending").

## Completed

### Phase 0 — Foundation

- Next.js 16 App Router application, strict TypeScript baseline.
- PostgreSQL + Redis Docker infrastructure; both containers carry healthchecks.
- Prisma 7 with the `@prisma/adapter-pg` driver adapter.
- Server-only database boundary and `db:check` connectivity verification.
- Phase 0 environment validation (`DATABASE_URL` required; `NODE_ENV` validated).
- `ActionResult` error/result convention.
- Tailwind CSS 4 + shadcn/ui design foundation using semantic tokens.
- Landing/public shell, branded 404, and global error pages.
- Vitest + Testing Library, Prettier gate, npm `allowScripts` allowlist, CI.

### Phase 1 — Authentication and onboarding

**Auth foundation and core**
- Better Auth 1.7.5 with a CLI-safe options module and a server-only runtime
  factory. `prismaAdapter` with `transaction: true`.
- Environment parsing split into a database-only contract (`parseEnv`, used by
  `db:check`) and a server-only auth contract (`parseAuthEnv`).
- Database-backed sessions with the cookie cache disabled. Sessions are always
  resolved from the database.
- Database rate limiting (Better Auth default rules, `storage: "database"`).
- `verification.storeIdentifier: "hashed"`, so verification and reset
  identifiers are never stored in plaintext.
- Server-owned identity fields: `globalRole` and `accountStatus` are declared
  with `input: false`, so a client cannot set them at sign-up.

**Auth UI**
- `/sign-up`, `/sign-in`, `/verify-email`, `/forgot-password`, `/reset-password`
  with accessible labels, Zod validation, and pending/disabled states.
- Verification-required and generic invalid-credential states.
- Password policy of 8–128 characters.

**Session and account-status policy**
- Session creation is refused unless an authoritative `ACTIVE` lookup succeeds.
  All uncertainty, including a database failure, collapses into one generic
  error, so a suspended account is indistinguishable from a wrong password.
- `requireActiveVerifiedSession` returns null for an inactive or unverified
  session, so an existing session stops working the moment an account is
  suspended.
- Email verification is required before a session can be created.
- Sign-out revokes the database session and clears the cookie.

**Onboarding and protected entry**
- Minimal `Profile` created from the authenticated identity only.
- `.strict()` Zod schema rejects unknown onboarding fields (no mass assignment).
- Idempotent completion guarded on `onboardingCompletedAt: null` inside a
  transaction, with a bounded retry on the unique-constraint race.
- `Profile.displayName` is the canonical display name; the signup name is only
  the starting value.
- `/onboarding` redirects to `/app` once complete; `/app` redirects to
  `/onboarding` while incomplete; both redirect to `/sign-in` when
  unauthenticated and to `/verify-email` when unverified.

**Production transactional email**
- Resend-backed adapter behind the existing `AuthEmailOperations` abstraction.
  Better Auth callbacks remain provider-agnostic.
- Smallest environment surface: `RESEND_API_KEY` and `AUTH_EMAIL_FROM_ADDRESS`.
  The display name `TeamMate` is fixed in code, so the env value must be a bare
  mailbox.
- Configuration is resolved lazily at send time and the provider client is
  constructed per send, so `npm ci`, `prisma generate`, local development, unit
  tests, integration tests, and a CI `next build` need no Resend credential.
- Fail-closed sanitized error taxonomy: every failure becomes one
  `AuthEmailDeliveryError` with a fixed message and a closed reason set. No
  provider error object, recipient, URL, token, or API key is ever logged,
  attached as `cause`, or returned.
- Production action URLs are validated before sending: absolute, HTTPS, no
  embedded credentials, and an exact origin match against `BETTER_AUTH_URL`.
- Recipient and sender addresses are validated as plain mailboxes with CR/LF
  rejected, so no header injection is possible.
- Verification-delivery enumeration normalization: the Better Auth verification
  callback converts a sanitized delivery failure into one fixed operational line
  and returns normally, so the native `send-verification-email` endpoint cannot
  distinguish a failed delivery from a missing or already verified account.
- Production additionally refuses a plaintext `BETTER_AUTH_URL` at send time,
  lazily, so a CI build with the build-only `http://localhost:3000` dummy stays
  valid.

**Phase 1 database**
- Migration `20260924082555_auth_onboarding_foundation` is unchanged since
  creation.

**Testing**
- 220 unit tests (Vitest) across 24 files.
- 76 PostgreSQL integration tests against a real, separately guarded
  `teammate_test` database (31 auth/onboarding, 28 Phase 2 schema-constraint, and
  17 own-profile tests).
- 15 Playwright end-to-end tests in Chromium covering the real browser journeys.
- Fail-closed test database guards for both integration and end-to-end suites.
- E2E email capture through a test-only filesystem transport that is unreachable
  from any production-mode process.

## External configuration still pending

These are deployment concerns, not code defects:

- **Live Resend delivery is unverified.** The adapter is implemented and
  unit/integration tested against a fake provider, but no real send has been
  performed. Required: `RESEND_API_KEY`, a Resend-verified sender domain, and
  `AUTH_EMAIL_FROM_ADDRESS` on that domain.
- **Sender-domain verification status is unknown.**
- **HTTPS `BETTER_AUTH_URL`** must be supplied by the deployment. Production
  refuses to send over plaintext.
- Production security headers are not configured yet (Phase 8 scope).
- Production managed PostgreSQL and Redis vendors are undecided.

## Deferred findings accepted

Reviewed and consciously accepted, with rationale recorded in
`09_SECURITY.md` and `10_TESTING.md`:

- `AuthEmailDeliveryError` identity uses `instanceof`; a future split of the
  email boundary into a separately compiled unit could make the guard fail open.
  Currently mitigated by an integration test that pins real HTTP behavior.
- Better Auth's 500 ms constant-time floor on the verification endpoint is a
  floor, not an equalizer, so a slow provider call is still timeable. Upstream
  behavior, unchanged here, bounded by rate limiting.
- The production action URL length cap (2048) can reject a very long
  `callbackURL`. Fail-closed availability only.
- E2E runs share the repository `.next/` directory with `npm run dev`.
- E2E is a local gate and is not part of hosted CI; see `10_TESTING.md` for why.

## In progress

**Phase 2 — Profiles and taxonomy.** Three checkpoints are complete.

*Schema and migration.* The `Profile` extensions, `Skill`, `UserSkill`,
`Interest`, and `UserInterest` models exist as migration
`20260926090638_phase2_profiles_and_taxonomy`, enforced by database constraint
tests against real PostgreSQL.

*Own profile read and edit.* `/app/profile` lets an onboarded user read and edit
`displayName`, `headline`, `bio`, `availabilityHoursPerWeek`, `timezone`, and
`profileVisibility`. All validation is server-side and authoritative.

*Taxonomy foundation.* Taxonomy is system-managed: no application surface lets an
ordinary user create, rename, recategorize, or delete a taxonomy row. A pure
normalization module derives `nameKey` (NFC, trim, collapse whitespace,
lowercase) and validates a curated slug grammar. `npm run seed:taxonomy` inserts
the product-owned starter set — 32 skills and 15 interests — and is idempotent,
non-destructive, and fail-closed on conflict. Read-only, session-scoped list
boundaries back the selection UI, with no taxonomy write path.

*Own skill and interest assignment.* `/app/profile` now carries Skills and
Interests cards alongside the existing profile form, each with its own server
actions and pending/error state. A user may add, update, and remove **their own**
`UserSkill` and `UserInterest` rows and nothing else. The user identity comes only
from the server session — no assignment action accepts a user identifier from
client input — so cross-user assignment is structurally impossible. Taxonomy ids
are validated as UUIDs and then verified against a real row. `proficiencyLevel` is
`BEGINNER`, `INTERMEDIATE`, `ADVANCED`, or `EXPERT`. `yearsExperience` is optional
and validated at **0..100 inclusive** by application rules only, with no database
CHECK constraint. Skill writes upsert on `(userId, skillId)` and interest adds
rely on `(userId, interestId)`, so repeated and concurrent submissions leave
exactly one assignment row. Removal is a scoped `deleteMany` on both columns, so
it can never delete a `Skill` or `Interest` row.

Deferred and still open:

- The public profile route and its URL shape are deferred. `profileVisibility`
  is stored and editable but nothing reads it yet, so it currently exposes
  nothing; the public-profile reader must filter on it rather than assume the
  write path protected it.
- `avatarUrl` is server-owned and has no write path until the trusted
  upload/storage checkpoint.
- Taxonomy administration is a later phase.

## Next target

The public profile reader: another user's profile route, the `PUBLIC` /
`MEMBERS_ONLY` projection that actually honors `profileVisibility`, and its
authorization and anonymity rules.

## Open decisions

- Production managed PostgreSQL vendor.
- Production Redis provider.
- Whether to promote E2E into hosted CI once a deterministic production-mode
  test server is possible without weakening the production reachability of the
  E2E email boundary.
