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

For authentication, also set `BETTER_AUTH_SECRET` (at least 32 characters, not
the example placeholder) and `BETTER_AUTH_URL` (an absolute http(s) URL). Local
`http://localhost:3000` is valid for development; production must use HTTPS.

`RESEND_API_KEY` and `AUTH_EMAIL_FROM_ADDRESS` are only needed to actually send
production email. Development and test runs use the in-memory and end-to-end
transports instead, so leave them unset locally. `AUTH_EMAIL_FROM_ADDRESS` must
be a bare mailbox on a Resend-verified domain — the `TeamMate` display name is
fixed in code.

Other values in `.env.example` (later-phase provider API keys) are needed only
when their features are implemented.

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

Two migrations exist (`20260924082555_auth_onboarding_foundation` and `20260926090638_phase2_profiles_and_taxonomy`) and both are applied to the development database. Use the migration workflow appropriate to pinned Prisma 7 for any reviewed change. Never use `prisma migrate reset` as a normal fix.

## Test databases

The integration and end-to-end suites both run against a separate database whose name must end in `_test`, never the development database. Create it once:

```powershell
docker compose exec postgres createdb -U teammate teammate_test
```

Then set `TEST_DATABASE_URL` in `.env`. Both suites fail closed if the test
database name does not end in `_test` or resolves to the development database.

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

## Avatar storage

Avatars are optional for local development. The S3-compatible client is created
lazily, so an empty configuration does not break a build, a typecheck, or the unit
tests. If you want to exercise a real upload locally, fill in the `S3_*` values in
`.env` from `.env.example`; avatar operations fail closed with a safe message when
they are missing.

A local MinIO-style endpoint over `http://` is accepted, but only when `NODE_ENV`
is exactly `development` or `test`. The rule is an allow-list rather than a
production check, so a missing, empty, or misspelled `NODE_ENV` denies plaintext
rather than permitting it. Leave `S3_ENDPOINT` unset to use real AWS, which
requires no endpoint at all.

The end-to-end suite does **not** need object storage. The guarded runner points the
application at a temporary directory for the duration of the run and removes it
afterwards, and avatars are still served back through the real `/avatars/<token>`
route with the real authorization, so the browser tests exercise the production
code path.

Live verification against a real S3-compatible provider has not been performed. No
credentials were created for it, and nothing was written to an unknown bucket; see
`09_SECURITY.md` and `STATUS.md`.
## Starter taxonomy

The skills and interests offered in profile editing come from a curated,
system-managed set. Install it once with:

```powershell
npm run seed:taxonomy
```

The command is safe to run repeatedly. It only inserts entries that are missing,
never updates or deletes an existing entry, and never touches user assignments.
If an existing entry disagrees with the starter set it stops and reports the
conflict rather than rewriting it. It prints the target database name so you can
confirm where it ran; the connection string is never printed.

Taxonomy is system-managed: there is no application screen or API for creating,
renaming, or deleting a skill or interest. Users can only select entries that
already exist, on their own profile at `/app/profile`. **If the taxonomy is empty
locally, the Skills and Interests cards on that page show an "unavailable" state
rather than letting you invent entries** — run `npm run seed:taxonomy` to populate
it.

## Playwright

Install the browser once, then run the end-to-end suite. It boots the real
application on port 3100 against `teammate_test` and removes its temporary
email-capture directory when it finishes.

```powershell
npx playwright install chromium
npm run test:e2e
```

The runner seeds the curated starter taxonomy into `teammate_test` before the
application starts, so the browser tests that assign skills and interests do not
depend on whatever happens to be left in that database. That seed is the same
approved, insert-if-missing boundary as `npm run seed:taxonomy`, and it runs only
after the existing database guard has proved the target is the test database. No
taxonomy write path is exposed to the application or to the Playwright workers,
and the per-test reset deliberately never deletes global taxonomy.

Do not run `npm run dev` at the same time: both servers write to the same
`.next/` directory.

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
