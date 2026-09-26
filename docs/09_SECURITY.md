# Security Baseline

## Threats explicitly considered

- broken access control / IDOR;
- account enumeration;
- brute-force login/reset attempts;
- CSRF where applicable;
- XSS;
- unsafe file upload/download;
- injection;
- insecure direct object references;
- leaked secrets;
- privilege escalation;
- duplicate/replayed state-changing requests;
- malicious AI output/prompt content;
- excessive AI/provider cost;
- dependency vulnerabilities.

## Controls

### Authentication
- verified email for collaboration actions;
- secure password/session handling through Better Auth;
- database-backed sessions with the cookie cache disabled;
- reset token expiry of one hour and single use, with identifiers stored hashed;
- rate limiting backed by the database;
- generic reset/login error messages where enumeration matters;
- an authoritative `ACTIVE` lookup is required before any session is created,
  and an inactive or unverified session resolves to no user at all;
- `globalRole` and `accountStatus` are server-owned and cannot be supplied by a
  client at sign-up.

### Authorization
Every protected object access checks the authenticated actor against the target resource. IDs in URLs/forms are untrusted identifiers, not permissions.

### Input/output
- Zod validation;
- React escaping by default;
- avoid unsafe HTML;
- sanitize/validate any future rich text;
- never interpolate unchecked user input into raw SQL.

### Files
- server-generated keys;
- allow-list file types where possible;
- explicit size limits;
- private-by-default storage for protected files;
- authorized download path/presigned URL;
- no arbitrary executable hosting behavior.

### Secrets
- `.env` never committed;
- `.env.example` contains names/placeholders only;
- provider keys are server-only;
- secret scanning in repository/CI where practical.

### Headers
Configure production security headers intentionally:
- Content-Security-Policy after evaluating app requirements;
- X-Content-Type-Options;
- Referrer-Policy;
- frame protection;
- permissions policy as appropriate.

### Audit
Record privileged/security-relevant events:
- admin suspend/restore;
- ownership/role changes;
- invitation/application decisions;
- account-security changes when appropriate.

Do not record credentials/tokens.

### Dependency overrides (temporary)

`package.json` pins two transitive dependencies via `overrides`:

- `deepmerge-ts` → `8.0.1`
- `mysql2` → `3.24.4`

They mitigate vulnerable transitive dependencies currently pulled through the Prisma 7.10.0 dependency chain. With the overrides applied, `npm audit` reports 0 vulnerabilities, and CI enforces `npm audit --audit-level=high` as a blocking step.

Rules:

- do not remove or update them automatically;
- remove an override only after verifying that a stable upstream dependency chain fixes the relevant advisories **and** all project gates pass without the override.

### npm lifecycle scripts

Install scripts are governed by the `allowScripts` allowlist in `package.json`. Approved pinned packages:

- `@prisma/engines@7.10.0`
- `prisma@7.10.0`
- `esbuild@0.28.2`
- `unrs-resolver@1.12.2`

Rules:

- no blanket approval;
- new dependency versions or newly introduced install scripts require individual review;
- after relevant dependency upgrades, run `npm approve-scripts --allow-scripts-pending` and resolve every reported package before proceeding.

The project's own `postinstall` (`prisma generate`) is intentional: it keeps the generated Prisma Client current on every install, including CI.

### Auth logging boundary

Better Auth 1.7.5 may pass raw database or provider exceptions as trailing log
arguments, and its router-level error path can log an `APIError.message`
globally. The configured logger therefore accepts only a level and publishes
fixed text, discarding every framework-supplied message and argument. It also
neutralises the upstream origin-check logger, which would otherwise echo
attacker-supplied `callbackURL` values.

Any non-`APIError` escaping Better Auth is converted by the guarded request
handler into an empty `500` with `cache-control: no-store`. The error is never
inspected, stringified, attached, or forwarded.

### Transactional email

- One outbound boundary, `AuthEmailOperations`. Application code never imports
  the provider SDK outside the production adapter.
- The provider's returned error object is collapsed to a boolean at the SDK
  binding, so no provider response body, status, or message can travel upward.
- Every failure becomes one `AuthEmailDeliveryError` with a fixed message and a
  closed reason set. No `cause` is attached.
- `RESEND_API_KEY` is read lazily, is never logged, and never appears in a
  thrown or serialized error.
- Emailed action URLs are validated before sending: absolute, HTTPS, no embedded
  credentials, no control characters, and an exact origin match against the
  configured `BETTER_AUTH_URL`. A user-supplied callback origin can never
  satisfy the check.
- Recipient and `AUTH_EMAIL_FROM_ADDRESS` must both be plain mailboxes with CR/LF
  rejected. The `TeamMate` display name is a code constant, so a second,
  unvalidated header source cannot exist.
- Production refuses a plaintext `BETTER_AUTH_URL` at send time. The check is
  lazy, so a CI build using the build-only `http://localhost:3000` dummy and no
  Resend credential still succeeds.

**Enumeration normalization.** Better Auth 1.7.5 rethrows a failed verification
send, which would let `send-verification-email` return a distinguishable failure
for an existing unverified account. The Better Auth verification callback
therefore converts a sanitized delivery failure into a single fixed operational
line, `"Verification email delivery failed."`, and returns normally. That line
accepts no arguments at all, so no recipient, URL, token, API key, or provider
detail can reach it. The transport still fails closed internally; only the
Better Auth boundary normalizes. Forgot-password is deliberately left unchanged
because Better Auth already swallows that failure, so a second swallow would
only duplicate behavior and diverge from the native flow.

**Operational note.** The Resend SDK writes its own raw error body to the
console when `NODE_ENV` is not `production`. This cannot happen here because
the transport selector only chooses the Resend adapter when `NODE_ENV ===
"production"`, which is the exact condition the SDK requires to stay quiet. Any
future change that activates the adapter outside production would also activate
SDK-level raw logging.

### Test-only boundaries

The end-to-end suite needs to read a verification or reset link. That is
obtained through a filesystem email transport with these properties:

- unreachable from any production-mode process, because the selector checks
  `NODE_ENV === "production"` first and the transport itself refuses production;
- inert during ordinary local development, because it additionally requires an
  explicit end-to-end context marker;
- no HTTP route, no API response, and no browser-reachable surface of any kind;
- the capture file must be an absolute path outside the repository, so live
  tokens cannot be staged or committed;
- the capture directory is created per run in the OS temp directory and removed
  on completion or on an interrupt;
- nothing is logged.

The end-to-end app is bound to the loopback host, because the local test auth
secret is a deterministic repository value and a network-reachable test server
would let anyone on the network mint a valid session cookie for the test
database.

### Own profile writes

The own-profile read and write boundary is session-scoped end to end. No
function, page, or action accepts a user identifier, and the page component
takes no props at all, so no route segment, query, or body key can influence
which profile is read or written.

Mass assignment is prevented by four independent layers rather than one check:

- the input schema is `.strict()`, so an unknown key is rejected instead of
  silently dropped;
- the Prisma payload is an explicit object literal built from validated output,
  and client input is never spread into it;
- the server boundary narrows the database to `Pick<PrismaClient, "profile">`,
  making the `user` delegate untypeable there, so auth-owned fields such as
  `globalRole` and `accountStatus` are structurally out of reach;
- the Better Auth identity fields remain declared `input: false` upstream.

The "must be onboarded" precondition is expressed inside the write itself as a
conditional update, so it cannot be raced by a prior read. `avatarUrl` is
absent from both the editable projection and the write payload.

Validation runs in the action and again inside the server boundary, and it is
the boundary parse that feeds the write, so removing the action-level parse
would not create a bypass. The schema accepts `null` for optional fields so that
re-validating an already normalized payload is a no-op; `null` is a distinct
value and cannot carry an over-length or control-character string past the
length and character rules, which are applied to the trimmed value that is
actually stored.

Unexpected failures collapse into one fixed generic message. Prisma errors, SQL,
connection strings, internal identifiers, auth internals, and stack traces are
never stringified, logged, or returned, and the Zod issue `input` is never read.

Rate limiting is not applied to this write. The action requires a valid active
and verified session, writes only the caller's own row, and has no external
provider cost, so this is accepted for now and recorded here rather than treated
as a defect.

### Own skill and interest assignments

The assignment boundary is session-scoped in the same way as the own-profile
boundary, and the protections are layered the same way:

- no assignment function, action, or component accepts `userId`, `profileId`,
  `targetUserId`, or `ownerId` from a caller. The identity is read from the server
  session, so a client cannot choose whose rows it writes. Cross-user assignment
  is therefore structurally impossible rather than merely unauthorized;
- the skill and interest schemas are `.strict()`, so a payload carrying
  `userId`, `globalRole`, `accountStatus`, `onboardingCompletedAt`, or a taxonomy
  field (`name`, `slug`, `nameKey`, `category`) is rejected outright;
- the Prisma write payloads are explicit object literals built from validated
  output, and client input is never spread into them;
- the database contract narrows `skill` and `interest` to `findUnique` only. A
  taxonomy create, update, or delete is not merely unused in this module — it is
  untypeable, so taxonomy cannot be poisoned or renamed through an assignment
  write even by mistake;
- the database contract omits the `user` delegate entirely, so auth-owned fields
  are out of reach.

Removal is a `deleteMany` scoped to **both** `userId` and the selected id. That
scoping is what guarantees a removal can neither delete a `Skill`/`Interest`
taxonomy row nor touch another user's assignment; both properties are pinned by
integration tests that assert taxonomy row counts are unchanged after removal.

Taxonomy ids are validated as UUID strings and then verified against a real row,
because a well-formed UUID proves nothing about existence. A well-formed but
unknown id returns a generic "Selected skill is unavailable" message. Taxonomy is
shared system data rather than user-owned data, so this discloses nothing about
any particular row or user, and the generic message is deliberate.

`yearsExperience` is validated as a whole number in the inclusive range 0..100 by
application rules only. There is deliberately **no** database `CHECK` constraint
on the column, so the bound is enforced solely by the schema. This is recorded as
a known limitation: any future write path that bypasses the Zod schema — a
migration, a script, or an admin tool — could store an out-of-range value. The
alternative, a `CHECK` constraint, would require migration 3 and was explicitly
deferred for this checkpoint.

Duplicate and concurrent submissions are handled by the database, not by
application logic: the skill write upserts on the `(userId, skillId)` unique key
and the interest add relies on `(userId, interestId)`, so repeated or racing
submissions leave exactly one row. There is no read-then-insert path that a race
could duplicate.

Onboarding completion is a precondition **read** rather than part of the write,
because `UserSkill` and `UserInterest` carry no onboarding column. This is
acceptable because onboarding completion is monotonic in Phase 1 — the guarded
onboarding update only ever completes and nothing reverses it — so a
read-then-write cannot produce an invalid state. If a future phase adds a way to
revoke onboarding, this must be revisited.


### Public profile viewing

`/profiles/[userId]` is the only surface that renders another person's data, and
it is read-only. The protections, and why each is here:

- **The path id is a locator, not a credential.** Authorization is recomputed from
  the server-resolved viewer and the target's current database state on every
  request. There is no cached decision and no client-supplied owner flag,
  visibility value, or hidden form field anywhere in the flow.
- **One answer for every unavailable case.** The boundary returns `null` for an
  unknown id, an unknown `Profile`, a malformed locator, an ineligible target, and
  a visibility the viewer lacks, and the page maps all of them to a single
  `notFound()`. Because the reasons are collapsed before they leave the boundary,
  the response cannot be used to enumerate accounts or to learn that an account is
  suspended, unverified, or half-onboarded. The route never redirects to sign-in,
  which would itself confirm that something exists at that id.
- **Target eligibility precedes visibility.** A suspended, unverified, or
  incomplete account is refused even for `PUBLIC`, and even for its own owner. A
  visibility setting cannot be used to keep an ineligible profile reachable.
- **Ineligible viewers are collapsed to anonymous.** An unverified or non-ACTIVE
  signed-in session resolves to the weakest viewer tier, so there is no code path
  where "authenticated" alone is treated as sufficient. Such a viewer can still
  read a `PUBLIC` profile, exactly as an anonymous visitor can, and gains nothing
  beyond that.
- **Two-phase read.** The first query fetches only what authorization needs. The
  projection query runs only after access is granted, so an unauthorized request
  never causes skill or interest rows to be loaded. A single combined query would
  read `yearsExperience` and other private columns for accounts the viewer may not
  see.
- **Minimal database contract.** The boundary takes `Pick<PrismaClient, "user">`,
  which has no write methods, so the module is structurally read-only. Every
  `select` is explicit, and an architectural test fails the build if a column that
  is not needed even for authorization (including `yearsExperience`, `timezone`,
  `availabilityHoursPerWeek`, and `nameKey`) is ever selected.
- **No locator validation theater.** The id is unbounded text with no schema
  format, so the route bounds length and rejects control characters, and otherwise
  lets a lookup miss become not-found. A stricter pattern would couple the route to
  a third-party id generator and could deny a legitimate user without adding any
  security, because the locator is not authorization.
- **No shared caching.** The route is viewer-dependent, so it renders per request
  via the header-reading session boundary and uses no `unstable_cache`,
  `revalidateTag`, or `use cache`. The build confirms it is dynamic. An
  architectural test asserts these stay absent so a later caching change cannot
  reintroduce cross-user leakage silently.
- **Static metadata.** Route metadata carries no profile data. `generateMetadata`
  resolves independently of the page, so a profile switched to `PRIVATE` in
  between could otherwise leak its display name into the head of a 404 response.
- **The id is never rendered or linked.** No page displays or links a user id, and
  the projection contains no identifier, so a rendered profile cannot be used to
  harvest locators.

Accepted and recorded rather than changed:

- Target eligibility and visibility are both evaluated in the first query, so a
  suspension landing between that query and the projection query lets one
  in-flight request render. This is the same read-precondition trade-off already
  accepted for onboarding and for the ACTIVE check on assignment writes, and it is
  bounded to a single request.
- `avatarUrl` is projected but never rendered. It has no write path, so it is
  always null today, and rendering an arbitrary remote image would require
  broadening the image allowlist for no current benefit. The page shows an
  initials placeholder.
- An unexpected failure while reading the session on the public route degrades to
  the anonymous tier rather than rendering a server error. This is fail-closed in
  the correct direction, because anonymous is the tier with the fewest rights, and
  it matches the existing fail-closed pattern in the auth options. The cost is that
  a database outage on this one route presents as a not-found page rather than a
  500, which would otherwise be a useful signal.
- `scripts/e2e-account-fixture.ts` inherits `E2E_TEST_CONTEXT` and `NODE_ENV`
  from the runner rather than setting them itself, so the guard's context checks
  are not vacuous for that entry point. The pre-existing
  `scripts/reset-e2e-database.ts` still self-asserts both; that is unchanged here,
  and the guard's load-bearing checks, which cannot be self-satisfied, still apply
  to it.- Public profile pages are not rate limited. Each read is a cheap indexed lookup by
  primary key, so the exposure is low, but it is a real gap that belongs with the
  release checklist.
## Accepted findings and residual risk

Recorded deliberately rather than changed mechanically:

- `AuthEmailDeliveryError` is matched with `instanceof`. Class identity holds
  today because the whole email boundary compiles into one server bundle, and
  the enumeration guard is additionally pinned by an integration test that
  asserts real HTTP behavior. If the boundary were ever split into a separately
  compiled unit, a shape-based reason check would be required.
- Better Auth's 500 ms constant-time floor on `send-verification-email` is a
  floor, not an equalizer, so a provider call slower than the floor remains
  timeable. This is upstream behavior, unchanged here, and bounded by the
  database rate limiter.
- The 2048-character cap on an emailed action URL can reject a very long
  `callbackURL`, because Better Auth percent-expands it. The result is a
  fail-closed refusal, not a leak.
- The leaf email modules are not individually marked `server-only`; the
  composition module is. This mirrors the existing development transport.
- `Profile.displayName` is not unique and is not Unicode-normalized, so two
  accounts can hold visually similar names. No authorization decision keys on the
  display name today, so this has no current privilege consequence; it becomes
  relevant when a public profile or search ordering exists.
- `profileVisibility` is enforced in exactly one place, the reader.
  `readVisibleProfile` filters on it in its authorization query and never returns
  it in the projection, so a new writer cannot expose a profile by forgetting a
  filter. The editable projection on `/app/profile` returns it to its owner, and
  no other surface reads it.
- Profile text length caps exist only at the Zod boundary; the columns are
  unbounded text with no database CHECK. This matches the documented project
  posture of validating at the server boundary.
- `UserSkill.yearsExperience` is likewise bounded 0..100 by the Zod schema only,
  with no database CHECK. Any future write path that does not go through the
  schema could store an out-of-range value. Recorded in
  `04_DATA_MODEL.md` as well; adding the constraint requires a migration.
- Assignment mutations are not rate limited. Each requires an ACTIVE verified
  session, writes only the caller's own join rows, and has no external provider
  cost, so the exposure is low, but it is a real gap rather than a solved one.
- The ACTIVE/verified precondition is a **read** on every assignment write, not a
  conditional update, because `UserSkill` and `UserInterest` carry no column that
  could fold the check into the write. A suspension landing between the session
  lookup and the write therefore lets exactly one in-flight request through. This
  is the same accepted trade-off as the onboarding precondition above, and it is
  bounded to a single request.
- The assignment list reads are unpaginated. This is safe by construction rather
  than by luck: the `(userId, skillId)` and `(userId, interestId)` unique
  constraints mean a user can hold at most one row per taxonomy entry, so a
  hostile client looping these actions cannot grow either list beyond the curated
  taxonomy size.
- Production security headers are not configured yet (Phase 8 scope). Current
  practical exposure is low because the application self-hosts fonts at build
  time and loads no third-party resources on the token-bearing pages.

## Security review trigger

Mandatory security review for changes involving:
- auth;
- permissions;
- route handlers;
- server actions on protected data;
- uploads;
- webhooks;
- admin;
- AI;
- logging;
- secrets;
- database state transitions.

## Release security checklist

- authorization tests pass;
- dependency audit reviewed;
- no exposed secrets;
- production env separated from local;
- rate limiting configured;
- error monitoring configured;
- uploads constrained;
- database backup/provider settings confirmed;
- admin routes protected;
- no debug endpoints.
