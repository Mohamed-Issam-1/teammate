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
- reset token expiry/single use;
- rate limiting;
- generic reset/login error messages where enumeration matters.

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
