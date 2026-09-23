# Testing Strategy

## Test pyramid

### Unit tests
Fast tests for:
- score calculations;
- state-transition rules;
- role/policy helpers;
- validation helpers;
- pure domain functions.

### Integration tests
Use a real test PostgreSQL database for high-value flows:
- create project;
- application acceptance transaction;
- invitation acceptance transaction;
- role/ownership transitions;
- authorization against real records;
- notification/activity creation.

Mocks are acceptable for external email/storage/AI provider calls.

### E2E
Playwright critical journeys:
1. register/verify/login path as test environment permits;
2. complete profile;
3. create project;
4. second user applies;
5. owner accepts;
6. member opens workspace and task;
7. invitation path;
8. unauthorized user blocked from private workspace;
9. admin-only route protection;
10. AI suggestions display without changing membership.

## Regression policy

A bug fix should include a regression test when practical.

## Test data

Prefer deterministic factories/builders over giant seed fixtures.

Never use production data.

## Commands

```bash
npm run test
npm run test:watch
npm run test:e2e
```

Release candidate verification:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

## Coverage

Do not chase a meaningless percentage. High-risk domain/auth logic requires strong coverage even if UI coverage is lower.
