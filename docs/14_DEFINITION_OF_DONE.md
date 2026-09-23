# Definition of Done

A feature/phase is not done until applicable items are satisfied.

## Behavior
- acceptance criteria implemented;
- edge cases/state transitions handled;
- no unrelated scope added.

## Security
- authentication requirement correct;
- server-side authorization correct;
- input validation present;
- no secret exposure;
- IDOR/cross-resource access considered;
- rate limiting applied where required.

## Data
- invariants enforced in business logic and DB constraints where practical;
- transactions used when needed;
- migration reviewed;
- no destructive migration surprise;
- indexes added for known query patterns.

## UX
- mobile + desktop checked;
- loading state;
- empty state;
- error state;
- permission-denied/not-found state where relevant;
- accessible labels/focus/keyboard behavior.

## Tests
- unit/integration tests for core behavior;
- authorization tests for protected behavior;
- regression test for bug fix when practical;
- E2E added/updated for critical flow.

## Verification
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- relevant E2E

## Documentation
- Source of Truth updated if canonical decision changed;
- feature/architecture/security/data docs updated;
- ADR added for significant architecture change;
- `STATUS.md` updated.

## Review
- diff reviewed;
- no accidental generated/secret files;
- no debug code;
- no unexplained TODO blocking production behavior.
