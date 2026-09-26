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
  to it.

- Public profile pages are not rate limited. Each read is a cheap indexed lookup by
  primary key, so the exposure is low, but it is a real gap that belongs with the
  release checklist.

### Avatar upload, storage, and delivery

Avatars are the first place a user-supplied binary reaches the server, so the
controls are layered:

- **The stored file is always server-produced.** The client sends bytes; the
  server decodes them with libvips, validates the *decoded* format, normalizes,
  and re-encodes WebP. The stored object is that WebP, never the upload. Nothing a
  client sends is ever served back.
- **Filename and `Content-Type` are treated as untrusted.** `processAvatarUpload`
  receives only a `Buffer`, which is the structural reason a mislabelled upload
  cannot change the outcome. Acceptance is the format the decoder reports, from an
  allowlist of `jpeg`, `png`, and `webp`.
- **SVG is refused explicitly.** libvips will rasterize SVG, and an SVG can carry
  script, so the allowlist is what rejects it rather than decoder tolerance. GIF,
  AVIF, PDF, HTML, and arbitrary binary are refused the same way.
- **Animation and multi-page sources are refused**, so a stored avatar is a single
  static frame and decode cost is bounded.
- **Metadata is dropped, not copied.** EXIF orientation is applied and the image is
  re-encoded into a fresh container, so EXIF, GPS, and any other source field do
  not survive. A unit test asserts the output carries no EXIF or ICC profile.
- **Authorization precedes body and image work.** The upload route verifies
  same-origin, then requires the avatar capability, and only then reads a body,
  parses the form, or decodes an image. A signed-out visitor issuing a same-origin
  request therefore cannot make the server run libvips, which is what keeps the
  endpoint from being an unauthenticated CPU and memory exhaustion primitive. The
  write boundary authorizes again immediately before it writes, so the early check
  is a fast rejection and never the only one. A regression test makes each stage
  observable and proves the earlier ones are unreachable for a refused caller.
- **The body read is bounded by a stream, not by a header.** `Content-Length` is
  treated as an optional fast-path hint only: it can be missing under chunked or
  HTTP/2 transfer, malformed, or simply wrong, and App Router route handlers apply
  no default body cap. The body is read with a byte counter that abandons the stream
  the moment the cap is passed, so an oversized or endless body never accumulates.
  A non-numeric length is deliberately not trusted as small. The request cap is the
  4 MiB file cap plus a 64 KiB multipart framing allowance; the 4 MiB file cap is
  then enforced independently on the parsed part.
- **`avatarUrl` is re-validated at the read boundary.** The public projection
  re-parses the stored value with the strict parser instead of trusting the column,
  exactly as the own-avatar read does. The write path only ever stores a canonical
  path, so this is defence in depth: a legacy value, a data fix, or any future
  writer cannot turn another member's profile into an arbitrary `src`.
- **`avatarUrl` is unique in the database.** Migration `avatar_url_unique` adds a
  unique index, so one non-null value maps to at most one profile and token
  resolution is a `findUnique` rather than a non-unique search. That makes "a token
  resolves to exactly one profile" structural instead of probabilistic, and it
  indexes a public, unauthenticated route. PostgreSQL excludes NULLs, so profiles
  without an avatar are unaffected. A token collision fails safely: the token is
  confirmed unreferenced *before* anything is stored, so a collision can never
  overwrite and then remove another profile's live object. After a bounded number
  of attempts the write fails with one generic error, and no unique-constraint
  violation can reach the client.
- **A plaintext endpoint is denied by default.** `S3_ENDPOINT` must be HTTPS unless
  the environment is *known* to be local, and the check is an allow-list on
  `NODE_ENV` rather than a production match. This matters because the project
  environment contract declares `NODE_ENV` optional, so a missing, empty, or
  misspelled value is a reachable state; a production-only check would have
  permitted plaintext in exactly that case. Only an exact `development` or `test`
  value may use `http://`, for local MinIO-style development, where a signed
  request carrying bucket credentials has nothing to expose. The check happens
  lazily at configuration read, so a build or typecheck with no configuration
  still succeeds.
- **The body reader bounds bytes, chunks, and time.** A byte cap alone would not
  stop a caller from sending a very large number of minimal chunks whose summed
  length never approaches it, and no byte cap would stop a stream that simply never
  ends. Empty chunks are never retained, the retained chunk count is separately
  bounded, and each read races a wall-clock deadline, so a source that stalls
  mid-stream is abandoned rather than merely one that produces too much. The chunk
  ceiling is set high enough that a legitimate 4 MiB upload survives transport
  segmentation, because refusing a valid maximum-size file would be its own bug.
- **A failed read is not reported as a size problem.** A disconnect, a proxy reset,
  a truncated body, and a stalled stream each produce an interrupted-read response
  rather than a 413. Collapsing them into "too large" would tell a legitimate user
  the wrong thing and would make a genuine size rejection indistinguishable in
  telemetry, which is the signal that a real over-limit body depends on.
- **The test filesystem adapter refuses production itself.** It carries its own
  marker and `NODE_ENV` check in addition to the selector's, mirroring the guarded
  development email transport, so a stray environment variable in a deployment
  cannot silently persist avatars to a local directory instead of the configured
  bucket.
- **Cleanup failures are visible.** Best-effort deletion stays best-effort, so a
  failed cleanup never fails the user's request, reverts a replacement, or restores
  a removed reference. Each of the three paths emits one fixed operational line with
  no arguments, so a persistently failing delete is no longer invisible. No provider
  error, endpoint, bucket, key, or token can reach the log.
- **Resource limits are enforced before expensive work.** The 4 MiB cap and the
  empty check run on the raw buffer, ahead of any decode; the endpoint also
  refuses an oversized declared `Content-Length` before buffering. A decoded-pixel
  ceiling stops a small file that declares enormous dimensions, and output is
  bounded to 512x512 with no upscaling.
- **Metadata stripping also removes a privacy leak.** A photo's EXIF commonly
  carries GPS coordinates, so stripping it is a disclosure control, not only
  hygiene.
- **The endpoint accepts one file and nothing else.** The form must contain exactly
  one entry named `file`. Extra fields are refused rather than ignored, so a client
  cannot smuggle a `userId`, `avatarUrl`, `bucket`, or `objectKey` alongside the
  image. There is no field for a user identifier at all: identity comes only from
  the session.
- **Storage keys are server-owned.** The key is `avatars/<token>.webp`, built from
  a CSPRNG UUID. No request value reaches a key, and the strict parser in front of
  every deletion accepts only the exact `/avatars/<token>` shape, so a traversal
  sequence, an absolute URL, a query string, or a legacy value never becomes an
  object key. The end-to-end filesystem adapter additionally verifies the resolved
  path stays inside its base directory and refuses any key outside the pattern.
- **Cross-user writes are structurally impossible.** The write boundary is
  session-scoped and takes no user identifier; the database contract is a
  method-level `Pick`, so `avatarUrl` is the only writable column and the `user`
  delegate is limited to reads. `User.image` is never written, which an
  integration test pins by seeding a legacy value and asserting it survives.
- **Delivery reuses the one visibility policy.** `/avatars/[token]` calls the same
  `isProfileVisibleTo` the public profile page calls, with the same shared
  authorization select, so an avatar can never be more permissive than the profile
  it belongs to. Possessing a token grants nothing: it resolves the owning profile
  and re-evaluates eligibility and visibility on every request.
- **Eligibility precedes visibility.** A suspended, unverified, or incomplete
  target is refused even for `PUBLIC`, and even for its own owner.
- **Every unavailable case is one 404.** Unknown token, malformed token, unknown
  profile, ineligible target, and a profile the viewer may not see are
  indistinguishable, so the route cannot enumerate tokens or disclose why access
  was refused. There is no listing, no search, and no prefix match on the stored
  URL.
- **Responses are `private, no-store` with `Vary: Cookie`.** Authorization is
  viewer-dependent and a profile's visibility can change at any moment, so a shared
  cache must never be able to hand a previously visible avatar to a viewer who is no
  longer entitled to it. The route is `force-dynamic` and no `unstable_cache` or
  `revalidateTag` is involved.
- **Avatars bypass the image optimizer on purpose.** A same-origin `<img>` is
  requested by the browser with its own session, so authorization is applied per
  viewer. An image optimizer running on the server would fetch the avatar without
  the viewer's cookie and could serve it to others, which would break `PRIVATE`
  and `MEMBERS_ONLY` outright. The route sends `nosniff` and a restrictive
  `Content-Security-Policy`, and the stored `Content-Type` is `image/webp`.
- **Cross-origin mutations are refused.** The upload and delete routes are plain
  POST/DELETE handlers, so they do not get the framework Origin check a Server
  Action would. `Origin` is compared against the server-configured application
  origin, taken from the same `BETTER_AUTH_URL` the auth boundary already trusts; a
  missing or unparseable origin is refused rather than assumed same-origin, and a
  request-supplied value can never satisfy the comparison.
- **The filesystem adapter cannot reach production.** It is selected only when the
  guarded end-to-end marker is present *and* `NODE_ENV` is not `production`. A stray
  environment variable in a real deployment therefore falls through to the S3
  adapter, which fails closed without configuration rather than writing to a
  temporary directory. There is no production fallback to the filesystem.
- **Credentials stay out of reach.** The S3 client is constructed lazily on first
  use, so a build, typecheck, or unit test needs no credentials. Credentials are
  supplied explicitly rather than picked up from the ambient environment, so the
  adapter cannot silently fall back to an unrelated source such as an instance
  role. No credential, endpoint, or bucket name is placed in a `NEXT_PUBLIC_*`
  variable, and a configuration failure is reported as one fixed message that names nothing at all, not even the missing variable names.
- **No raw provider or library error escapes.** Every S3 failure becomes a generic
  `AvatarStorageOperationError`, every decode failure a generic
  `AvatarUndecodableError`, and the routes map both onto fixed user-facing strings.
  A missing object is treated as a normal outcome and stays indistinguishable from
  any other unreadable avatar.
- **No presigned URLs and no public bucket URL.** The browser receives only the
  same-origin `/avatars/<token>` path, and the object is written with
  `CacheControl: private, no-store`. The `.env.example` `S3_PUBLIC_BASE_URL` is
  deliberately unused.

Accepted and recorded rather than changed:

- Database and object storage cannot share a transaction. The upload ordering
  (store new, update the database, then delete the old object) means a crash
  between the last two steps leaves an unreferenced object in the bucket. That
  residual orphan is accepted because the alternative, deleting the old object
  first, could leave a profile pointing at bytes that no longer exist. A periodic
  reconciliation job is later operational work.
- Conversely, a failed delete after a successful database update never reverts the
  profile to the old avatar, and a failed cleanup on removal never restores the
  reference. A leftover object that nothing points at is preferred over a
  reachable avatar, so privacy state in the database always wins.
- Upload is not rate limited. Each request requires an ACTIVE verified session,
  accepts one file, is capped at 4 MiB, and is decoded and re-encoded server-side,
  so the exposure is bounded, but repeated uploads remain a possible cost. The only
  existing limiter is Better Auth's internal one, which owns the `RateLimit` table
  and its key format; writing to it from application code risks colliding with auth
  throttling, so a separate limiter is deferred rather than invented here.
- The avatar GET route is a public HTTP surface, so it is the one route where
  response timing could in principle differ between "denied" and "granted" (a
  granted read performs an extra storage fetch). It reveals only whether the viewer
  is already entitled to the resource.
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
