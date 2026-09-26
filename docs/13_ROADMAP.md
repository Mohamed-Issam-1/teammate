# Implementation Roadmap

Do not skip quality gates between phases.

## Phase 0 — Foundation

Deliver:
- scaffolded Next.js application;
- TypeScript strict baseline;
- Tailwind/shadcn design foundation;
- Prisma/PostgreSQL connectivity;
- local Docker infrastructure;
- environment validation;
- project folder architecture;
- error/result conventions;
- basic test setup;
- CI skeleton;
- landing/app shell placeholders;
- documentation verified against repository.

Exit criteria:
- app starts;
- DB connection works;
- lint/typecheck/test/build pass;
- CI can run core checks;
- no product feature implementation yet.

## Phase 1 — Authentication and onboarding

Status: **code complete**. Live production email delivery remains externally
unverified pending deployment credentials, a verified sender domain, and an
HTTPS `BETTER_AUTH_URL`. See `STATUS.md`.

Deliver:
- Better Auth integration;
- registration;
- email verification;
- login/logout;
- forgot/reset password;
- database sessions;
- protected app shell;
- suspended/verification policy foundations;
- onboarding shell;
- auth E2E/integration coverage.

Exit criteria:
- unit, PostgreSQL integration, and Playwright E2E suites pass;
- no unresolved HIGH/CRITICAL security finding;
- documentation synchronized with the implementation;
- production email adapter implemented and fail-closed, with live provider
  verification explicitly tracked as an external deployment task.

## Phase 2 — Profiles and taxonomy

Deliver:
- profile edit/public profile;
- skills/interests;
- availability;
- avatar integration groundwork;
- profile search eligibility;
- validation and permissions.

## Phase 3 — Projects and discovery

Deliver:
- create/edit/archive;
- required skills/interests;
- lifecycle;
- project listing/search/filter/pagination;
- detail page;
- permissions.

## Phase 4 — Team formation

Deliver:
- applications;
- invitations;
- state machines;
- atomic membership creation;
- project roles;
- ownership invariants;
- notifications/activity foundation;
- strong authorization tests.

## Phase 5 — Workspace and files

Deliver:
- workspace shell;
- Kanban columns;
- tasks/assignees;
- activity timeline;
- attachments with object storage;
- authorization;
- responsive drag/drop or accessible alternative.

## Phase 6 — Notifications and AI matching

Deliver:
- notification center;
- email notifications for selected events;
- rate limiting;
- deterministic matching;
- AI explanations;
- AI usage/cost controls;
- evaluation fixtures.

## Phase 7 — Admin and moderation

Deliver:
- admin dashboard;
- user/project lookup;
- suspend/restore;
- moderation actions;
- admin audit log;
- admin authorization tests.

## Phase 8 — Production hardening

Deliver:
- observability;
- security headers;
- rate limits audited;
- dependency/security review;
- performance/index review;
- accessibility pass;
- full E2E suite;
- CI/CD finalized;
- production deployment;
- smoke tests;
- README/portfolio documentation;
- architecture diagrams/screenshots.

## Rule

A phase is complete only when `14_DEFINITION_OF_DONE.md` is satisfied for its scope.
