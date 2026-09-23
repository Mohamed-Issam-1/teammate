# TeamMate — Source of Truth

**Status:** Canonical
**Purpose:** Single authoritative reference for product scope, architecture, engineering rules, and delivery decisions.

---

## 1. Product definition

TeamMate is a SaaS platform that helps people:

1. create a structured professional/student profile;
2. discover projects and potential teammates;
3. create projects and define required skills;
4. apply to projects or invite people;
5. form teams with explicit membership and roles;
6. collaborate in a project workspace with tasks/Kanban;
7. receive in-app and email notifications;
8. attach files to relevant collaboration objects;
9. discover teammates through explainable AI-assisted matching;
10. give administrators tools to moderate users/projects and inspect auditable events.

TeamMate is not a generic social network, chat platform, project-management replacement, hiring marketplace, or AI decision-maker.

---

## 2. Product principles

- **Useful before AI:** all core collaboration flows work without AI.
- **AI assists, humans decide:** AI may rank/suggest/explain candidates but never autonomously accepts, rejects, joins, removes, or changes roles.
- **Security is server-side:** client UI visibility is not an authorization mechanism.
- **Production-like over feature count:** complete fewer features correctly rather than shipping broad CRUD.
- **Explainable state:** users should understand invitation/application/task states.
- **Reviewable development:** small vertical slices, tests, and documentation updates.
- **Accessible/responsive:** mobile and desktop are first-class.

---

## 3. Canonical stack

### Runtime/application
- Node.js 24 LTS target
- Next.js App Router
- TypeScript strict mode
- React
- Tailwind CSS
- shadcn/ui

### Data/auth
- PostgreSQL
- Prisma 7 stable
- Better Auth with database-backed sessions
- Zod for boundary validation

### Client forms/data
- React Hook Form for substantial forms
- TanStack Query only for client-side async state that benefits from caching/refetching

### Quality
- ESLint
- Prettier
- Vitest
- React Testing Library
- Playwright

### Infrastructure
- Docker Compose for local PostgreSQL/Redis
- GitHub
- GitHub Actions
- Vercel
- Managed PostgreSQL in production
- Redis-compatible service for rate limiting/cache where required
- S3-compatible object storage for attachments
- Resend-compatible email delivery
- Sentry-compatible error monitoring

### AI
- OpenAI API initially
- deterministic eligibility + weighted scoring before LLM explanation
- provider integration behind a small service boundary to allow replacement

---

## 4. Architecture

Use a modular monolith. Do not start with microservices.

Target source structure:

```text
src/
  app/                 # routes, layouts, route handlers; keep thin
  components/
    ui/                # shadcn/design-system primitives
    shared/            # cross-feature components
  features/
    auth/
    profiles/
    projects/
    teams/
    workspace/
    notifications/
    search/
    ai-matching/
    admin/
  server/
    auth/
    db/
    authorization/
    services/
    repositories/      # only where it provides real value
    rate-limit/
    storage/
    email/
    ai/
  lib/                 # shared non-domain utilities
  generated/           # generated Prisma client; never hand edit
prisma/
tests/
  integration/
  e2e/
docs/
```

Rules:
- pages/layouts compose behavior; they do not own complex business rules;
- server-only logic stays server-only;
- feature modules own feature schemas/components where practical;
- authorization functions are centralized enough to avoid inconsistent policy;
- external providers are wrapped behind server adapters/services.

---

## 5. User roles

### Global roles
- `USER`
- `ADMIN`

### Project/team roles
- `OWNER` — creator; full project/team control
- `MANAGER` — delegated management, except ownership transfer/destructive owner-only actions
- `MEMBER` — collaboration access

A user can have different project roles in different projects.

Authorization must combine:
- authenticated identity;
- global role;
- project membership;
- project role;
- resource ownership/state.

---

## 6. Core product scope

### Authentication/account
- sign up with email/password;
- email verification;
- sign in/sign out;
- forgot/reset password;
- session management;
- profile onboarding;
- account settings;
- safe account deactivation/deletion design.

### Profiles
- display name;
- headline/bio;
- avatar;
- skills + proficiency;
- interests;
- availability;
- timezone/location text where needed;
- public profile;
- privacy-safe contact handling.

### Projects
- create/edit/archive project;
- title, summary, description;
- visibility;
- status;
- required skills;
- desired team size;
- availability expectations;
- tags/interests;
- owner.

### Team formation
- apply to project;
- withdraw pending application;
- owner/manager accepts/rejects;
- invite user;
- invitee accepts/declines;
- membership creation is transactional;
- prevent duplicate pending application/invitation/membership;
- role changes subject to policy;
- owner cannot accidentally orphan project ownership.

### Workspace
- project overview;
- member list;
- Kanban board;
- configurable columns within bounded rules;
- tasks;
- assignees;
- due dates;
- priority;
- task descriptions;
- activity log.

### Notifications
- in-app notifications;
- unread/read state;
- email for high-value events;
- notification preferences later if scope allows.

### Search/discovery
- people search;
- project search;
- filters by skills/interests/status/availability;
- pagination;
- safe indexing.

### Attachments
- object storage;
- file metadata in DB;
- size/type limits;
- authorization before upload/download;
- no arbitrary executable upload exposure.

### Admin
- user lookup;
- suspend/restore user;
- project lookup/moderation;
- basic platform metrics;
- audit log access;
- no silent destructive moderation.

### AI matching
- suggested candidates for a project;
- score components visible;
- brief explanation;
- respect availability and visibility;
- no autonomous membership decision;
- rate/cost limits;
- cache/reuse results where appropriate.

---

## 7. Explicitly out of scope for initial production-like release

Unless the Source of Truth is updated:
- real-time chat;
- video/voice calls;
- payments/subscriptions;
- multi-tenant organizations;
- native mobile apps;
- public marketplace payments;
- AI agents acting on behalf of users;
- fully customizable workflow engine;
- microservices;
- Kubernetes.

---

## 8. Data model — canonical domain entities

Authentication tables are owned/generated by Better Auth integration.

Domain entities:

- `Profile`
- `Skill`
- `UserSkill`
- `Interest`
- `UserInterest`
- `Project`
- `ProjectRequiredSkill`
- `ProjectInterest`
- `ProjectMember`
- `ProjectApplication`
- `ProjectInvitation`
- `BoardColumn`
- `Task`
- `TaskAssignee`
- `Attachment`
- `Notification`
- `ActivityLog`
- `AiMatchRun`
- `AiMatchCandidate`
- `AdminAction` or equivalent auditable record

Exact fields/indexes are defined in `04_DATA_MODEL.md`.

---

## 9. State rules

### Project
Planned states:
- `DRAFT`
- `OPEN`
- `IN_PROGRESS`
- `COMPLETED`
- `ARCHIVED`

### Application
- `PENDING`
- `ACCEPTED`
- `REJECTED`
- `WITHDRAWN`

### Invitation
- `PENDING`
- `ACCEPTED`
- `DECLINED`
- `REVOKED`
- `EXPIRED`

Invalid state transitions must be rejected server-side.

---

## 10. API/action strategy

- Server Components: reads where possible.
- Server Actions: UI-coupled authenticated mutations.
- Route Handlers:
  - Better Auth;
  - external webhooks;
  - upload signing;
  - AI matching endpoints;
  - endpoints intended as HTTP contracts.
- All mutations validate with Zod and authorize on the server.
- Public/HTTP endpoints return consistent problem/error shapes.
- Idempotency is required where duplicate submission would create duplicate membership/invitations or external side effects.

See `06_API_AND_SERVER_ACTIONS.md`.

---

## 11. Security baseline

Before production:
- email verification;
- secure password handling through auth framework;
- database-backed sessions;
- server-side authorization;
- rate limiting on sensitive endpoints;
- CSRF protections appropriate to chosen mechanisms;
- Zod validation;
- safe error messages;
- no secrets in browser bundles;
- object-storage upload constraints;
- secure headers;
- dependency scanning;
- audit logs for privileged actions;
- account suspension enforcement;
- authorization tests for protected operations.

See `09_SECURITY.md`.

---

## 12. Testing baseline

Required:
- unit tests for domain rules;
- integration tests for important server/database flows;
- Playwright for critical happy-path and authorization flows;
- regression tests for meaningful bugs;
- CI quality gates.

Minimum merge/release checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

E2E is required for release candidates.

---

## 13. UX baseline

- responsive from small mobile to desktop;
- semantic design tokens;
- light/dark themes;
- accessible forms and keyboard behavior;
- loading/skeleton states;
- empty states;
- inline validation;
- recoverable error states;
- clear permission-denied states;
- confirmation for consequential actions;
- no hidden destructive actions;
- optimistic updates only when rollback/error handling is safe.

---

## 14. Observability

Production release requires:
- structured server errors;
- error monitoring;
- request correlation where practical;
- no secret/credential logging;
- audit logs for security/domain events;
- basic product analytics respecting privacy;
- AI usage/cost metrics.

---

## 15. Deployment model

Initial production architecture:

```text
Browser
  |
Vercel / Next.js
  |---- Managed PostgreSQL
  |---- Redis-compatible service
  |---- S3-compatible object storage
  |---- Email provider
  |---- OpenAI API
  |---- Error monitoring
```

Local development uses Docker Compose for PostgreSQL and Redis.

---

## 16. Engineering workflow

For every meaningful feature:

1. confirm roadmap item and requirement IDs;
2. use Plan mode first for substantial changes;
3. inspect current code;
4. implement one vertical slice;
5. add/update tests;
6. run verification;
7. run code review/security review when applicable;
8. update docs and `STATUS.md`;
9. review diff;
10. commit only when explicitly requested.

---

## 17. Definition of done

A feature is done only when:
- acceptance criteria pass;
- permissions/authorization are enforced;
- validation and error states exist;
- tests cover core behavior;
- relevant quality gates pass;
- docs reflect the shipped behavior;
- no known critical/high security defects remain.

See `14_DEFINITION_OF_DONE.md`.

---

## 18. Decision precedence and change control

If documents conflict, use this order:

1. `docs/00_SOURCE_OF_TRUTH.md`
2. accepted ADRs in `docs/adr/`
3. security/auth/data architecture documents
4. SRS
5. PRD
6. roadmap/status
7. code comments

However, accepted architectural changes must also update this Source of Truth promptly so it remains canonical.

Significant architectural changes require:
- rationale;
- alternatives considered;
- consequences;
- an ADR;
- Source of Truth update.

---

## 19. Current delivery target

Build a **production-like portfolio release**, not a toy MVP.

The implementation is split into phases in `13_ROADMAP.md`. Later phases must not be pulled forward casually.

---

## 20. Open questions

Open questions are not permission to guess. Record unresolved decisions in `docs/STATUS.md` and resolve them before implementation if they materially affect architecture/security.

Initial known decisions still allowed to be finalized later:
- exact managed PostgreSQL vendor;
- exact S3-compatible storage vendor;
- exact Redis provider;
- exact email domain/provider configuration;
- final AI model selection and per-user quota.

The interfaces and boundaries should prevent these provider choices from leaking throughout the codebase.
