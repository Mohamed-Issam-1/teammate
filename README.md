# TeamMate

TeamMate is a production-oriented SaaS platform for finding teammates, forming project teams, and collaborating through a shared workspace.

The product combines structured profiles, project applications/invitations, team workspaces, task management, notifications, auditability, and an explainable AI-assisted teammate matching feature.

## Source of truth

Start with:

- `docs/00_SOURCE_OF_TRUTH.md` — canonical product and engineering reference
- `docs/STATUS.md` — current project state
- `docs/13_ROADMAP.md` — implementation phases
- `AGENTS.md` — instructions for coding agents and contributors
- `docs/16_OPENCODE_WORKFLOW.md` — how to use Plan/Build, agents, and commands safely

If documentation conflicts, follow the precedence rules in `docs/00_SOURCE_OF_TRUTH.md`.

## Core stack

- Next.js App Router + TypeScript
- Tailwind CSS + shadcn/ui
- PostgreSQL
- Prisma 7
- Better Auth
- Zod + React Hook Form
- TanStack Query only where client-side caching is justified
- Vitest + Testing Library
- Playwright
- Docker for local infrastructure
- GitHub Actions
- Vercel

## Local development

See `docs/15_LOCAL_SETUP.md`.

Typical commands:

```bash
npm ci                # lockfile-exact install; postinstall generates the Prisma Client
docker compose up -d
npm run dev
npm run verify        # format:check → lint → typecheck → test → build
npm audit --audit-level=high
```

## Development policy

Do not implement the entire roadmap in one agent session. Work phase-by-phase or feature-by-feature, keep changes reviewable, add tests with behavior, and update project documentation when architectural or product behavior changes.
