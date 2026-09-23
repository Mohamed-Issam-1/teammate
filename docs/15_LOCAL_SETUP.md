# Local Setup — Windows / PowerShell

## Required tools

Check:

```powershell
node --version
npm --version
git --version
docker --version
docker compose version
opencode --version
```

Target:
- Node.js 24 LTS
- current npm bundled with Node
- Git
- Docker Desktop
- OpenCode V2

## Start local services

```powershell
docker compose up -d
docker compose ps
```

`docker compose ps` should show both services `healthy`.

PostgreSQL:
- host: localhost
- port: 5432
- database: teammate
- user: teammate
- password: teammate

Redis:
- localhost:6379

These credentials are local-development-only.

## Environment

```powershell
Copy-Item .env.example .env
```

Set a valid `DATABASE_URL`. Phase 0 validation requires it before starting the server or running database scripts.

Other values in `.env.example` (Better Auth secret, provider API keys) are needed only when their features are implemented.

Never commit `.env`.

## Install dependencies

Preferred — reproducible, lockfile-exact:

```powershell
npm ci
```

Use `npm install` only when adding or upgrading dependencies (it updates `package.json` and `package-lock.json`).

After every install, `postinstall` runs `prisma generate`, so the Prisma Client in `src/generated/prisma` (gitignored) is created automatically — no manual generate step is needed.

Install scripts are limited to the reviewed allowlist in `package.json`. If npm reports unreviewed scripts after an install, review them individually and run:

```powershell
npm approve-scripts --allow-scripts-pending
```

Never give blanket script approval.

## Prisma

Validate the schema:

```powershell
npx prisma validate
```

Check the live database connection (services must be running):

```powershell
npm run db:check
```

No migration exists yet — by design. When a reviewed development migration becomes required, use the migration workflow appropriate to pinned Prisma 7. Never use `prisma migrate reset` as a normal fix.

## App

```powershell
npm run dev
```

## Quality

Individual gates:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Run everything in order:

```powershell
npm run verify
```

Dependency audit (blocking at `--audit-level=high`; CI runs the same check):

```powershell
npm audit --audit-level=high
```

## Playwright

E2E is deferred to Phase 1; `npm run test:e2e` is intentionally inactive until then. When E2E work starts:

```powershell
npx playwright install chromium
npm run test:e2e
```

## OpenCode workflow

From repository root:

```powershell
opencode
```

Start substantial work in Plan mode. Let Build mode edit only after the plan is understood.

The project contains:
- `AGENTS.md`;
- `opencode.jsonc`;
- custom subagents;
- custom slash commands.

Do not use auto-approval broadly on your first production project. The config intentionally asks before most shell commands and blocks dangerous Git/database operations.
