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
