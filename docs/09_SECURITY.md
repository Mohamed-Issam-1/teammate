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
