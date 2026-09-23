# OpenCode Workflow for TeamMate

This project uses OpenCode as an engineering assistant, not as an uncontrolled “build everything” generator.

## 1. Persistent project context

`AGENTS.md` contains repository-wide rules that OpenCode should follow throughout the project.

The canonical product/architecture decisions live in `docs/00_SOURCE_OF_TRUTH.md`.

Do not duplicate all project requirements into prompts. Refer the agent to these documents.

## 2. Primary modes

### Plan
Use before:
- a new roadmap phase;
- authentication/security changes;
- database redesign;
- a new major feature;
- changes touching multiple domains.

Expected output:
- scope;
- requirement IDs;
- affected files;
- data changes;
- security impact;
- tests;
- risks;
- verification plan.

Plan mode should not modify normal project files.

### Build
Use after the plan is accepted/understood.

Build mode:
- edits files;
- runs allowed/requested commands;
- implements one bounded scope;
- tests and verifies;
- updates docs.

## 3. Custom subagents

### `architect`
Read-only. Use before complicated architecture/data changes.

Example:

```text
Use @architect to analyze the proposed invitation acceptance workflow before implementation.
```

### `reviewer`
Read-only. Reviews correctness, regressions, architecture drift, and tests.

### `security-reviewer`
Read-only. Reviews auth/authorization/IDOR/input/files/AI/provider risks.

## 4. Custom commands

### `/feature`
Use for one feature:

```text
/feature PRJ-001 through PRJ-003: create project with required skills and desired team size.
```

### `/verify`
Runs/coordinates relevant quality gates and fixes in-scope failures.

### `/review`
Runs read-only code review.

### `/security`
Runs focused security review.

### `/docs-sync`
Updates documentation only when implementation changed documented behavior.

## 5. Recommended session pattern

For a substantial feature:

```text
1. Plan mode
2. Inspect and approve/adjust plan
3. Build mode
4. /feature <bounded scope>
5. /verify
6. /review
7. /security   # if security-sensitive
8. /docs-sync
9. inspect git diff yourself
10. commit only after review
```

## 6. Prompt quality

Good:

```text
Implement APP-001 to APP-004 only.
Follow the existing application state model.
Add server-side authorization and regression tests.
Do not implement owner decision actions yet.
```

Bad:

```text
Make the applications system complete and professional.
```

Good prompts state:
- exact requirement IDs;
- exact scope;
- what is explicitly excluded;
- verification expectation.

## 7. Context management

Start a fresh OpenCode session when:
- moving to a new major phase;
- the previous session accumulated unrelated debugging context;
- the agent begins mixing completed and future requirements.

A fresh session is safe because the repository contains persistent context in:
- `AGENTS.md`;
- Source of Truth;
- STATUS;
- roadmap;
- ADRs.

## 8. When OpenCode proposes a major change

Do not accept silently if it wants to:
- replace the auth library;
- replace the ORM/database;
- move to a separate backend;
- add a queue/microservice;
- restructure the entire repository;
- change authorization model;
- introduce a destructive migration.

Require an ADR-style explanation:
- problem;
- proposed change;
- alternatives;
- benefits;
- risks;
- migration cost.

Then update the Source of Truth if accepted.

## 9. Git and database safety

The project config blocks or prompts for risky commands, but still review requested shell actions.

Never use “reset everything and try again” as normal debugging.

For DB issues:
1. inspect current schema/migrations;
2. identify actual mismatch;
3. create an additive/reviewed migration;
4. preserve data unless the environment is explicitly disposable and you approved reset.

## 10. End-of-session checkpoint

Before ending meaningful work, ensure `docs/STATUS.md` states:
- current phase;
- completed items;
- current in-progress item;
- next target;
- blockers/open decisions;
- known risks.

This is the fastest way for the next OpenCode session to resume correctly.
