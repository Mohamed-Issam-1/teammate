# Authentication and Authorization

## Authentication

Use Better Auth with PostgreSQL/Prisma-backed persistence.

Required release capabilities:
- email/password signup;
- email verification;
- login/logout;
- password reset;
- database-backed sessions;
- session invalidation;
- suspended-user enforcement.

OAuth/passkeys may be added later without replacing the core authorization model.

## Phase 1 implementation

- Better Auth 1.7.5, `prismaAdapter` with `transaction: true`, composed from a
  CLI-safe options module and a server-only runtime factory.
- Email and password, 8–128 characters, with email verification required before a
  session may be created. Verification never creates a session on its own.
- Database-backed sessions with the cookie cache disabled, so a session is always
  re-read from the database.
- Verification and reset identifiers are stored hashed
  (`verification.storeIdentifier: "hashed"`). Both tokens expire after one hour
  and are single use.
- A successful password reset revokes existing sessions.
- `globalRole` and `accountStatus` are server-owned fields declared with
  `input: false`, so a client cannot set them during sign-up.
- Rate limiting is database-backed.

### Session and account-status policy

Session creation is refused unless an authoritative `ACTIVE` lookup succeeds.
Any uncertainty, including a database failure, collapses into one generic error,
so a suspended account is indistinguishable from a wrong password. An existing
session for an inactive or unverified account resolves to no user at all, so
suspending an account takes effect immediately rather than at next sign-in.

### Known upstream residual risk

Better Auth 1.7.5 does not guarantee a single transaction spanning reset-token
consumption, the password update, and session revocation. Phase 1 accepts this
native-flow limitation rather than reimplementing the flow.

### Transactional email

Verification and reset mail are delivered through the `AuthEmailOperations`
boundary, which Better Auth callbacks depend on instead of a provider SDK. The
production adapter is Resend-backed and configured lazily; see
`09_SECURITY.md` for the enumeration-normalization rule and the exact
environment contract.

### Better Auth setup

Required environment:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` — at least 32 characters, never the example placeholder
- `BETTER_AUTH_URL` — absolute URL; HTTPS in production

Required for production sending only:

- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM_ADDRESS` — bare mailbox on a Resend-verified domain

The trusted origin for emailed links is derived from `BETTER_AUTH_URL`, so email
link validation and Better Auth always share one source of truth.

## Authorization model

Authentication answers “who is this?”
Authorization answers “may this identity perform this action on this resource?”

Never infer authorization from UI visibility.

## Global roles

- USER
- ADMIN

## Project roles

- OWNER
- MANAGER
- MEMBER

## Example policy matrix

| Action | Owner | Manager | Member | Non-member |
|---|---:|---:|---:|---:|
| View public project | Yes | Yes | Yes | Yes |
| View private workspace | Yes | Yes | Yes | No |
| Edit project settings | Yes | Yes* | No | No |
| Archive project | Yes | No | No | No |
| Invite candidate | Yes | Yes | No | No |
| Decide application | Yes | Yes | No | No |
| Change member role | Yes | Limited | No | No |
| Transfer ownership | Yes | No | No | No |
| Create/update task | Yes | Yes | Yes | No |
| Admin suspend user | Only if global ADMIN | | | |

`*` Owner-only fields/actions remain restricted.

## Authorization implementation

Create explicit server policy functions, for example:
- `requireUser()`
- `requireVerifiedUser()`
- `requireAdmin()`
- `getProjectAccess(userId, projectId)`
- `requireProjectRole(projectId, allowedRoles)`
- action-specific guards when state matters.

Do not create a single giant permission function with hidden behavior.

## Security-sensitive tests

Test:
- unauthenticated calls;
- authenticated non-member;
- normal member;
- manager;
- owner;
- admin where relevant;
- suspended user;
- cross-project IDOR attempts;
- stale/invalid invitation/application state.
