# DevOps and Deployment

## Environments

- local
- preview
- production

Do not share database credentials between environments.

## Git workflow

Recommended:
- `main` = releasable
- short-lived feature branches
- PR review
- CI required before merge

OpenCode must not push automatically.

## CI pipeline target

On pull request:
1. install from lockfile;
2. lint;
3. typecheck;
4. unit/integration tests;
5. build;
6. optionally E2E against ephemeral/test infrastructure;
7. dependency/security checks.

## Database migrations

- migrations are committed;
- review SQL/behavior;
- no reset workflow;
- production uses deployment-safe migration command appropriate to the pinned Prisma version;
- breaking/destructive changes require staged migration strategy.

## Vercel

Use Vercel for Next.js preview and production deployments.

Environment variables must be configured in Vercel, not committed.

## Database

Production uses managed PostgreSQL with:
- backups;
- TLS;
- pooled/serverless-compatible connectivity where required;
- separate production credentials;
- observability.

Provider is intentionally replaceable.

## Object storage

Use S3-compatible private bucket for protected attachments. Production upload/download should use short-lived presigned operations or controlled proxying.

## Redis

Use for:
- rate limiting;
- short-lived cache;
- idempotency/replay protection where useful.

Do not make core source-of-truth data depend on Redis.

## Release procedure

1. all quality gates green;
2. migrations reviewed;
3. env vars confirmed;
4. preview smoke test;
5. security checklist;
6. production deploy;
7. smoke test critical flows;
8. monitor errors;
9. record release/status.
