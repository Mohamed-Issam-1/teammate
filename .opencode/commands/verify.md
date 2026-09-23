---
description: Verify the current implementation against project quality gates.
agent: build
---

Read AGENTS.md and verify the current requested/current changes.

Run the relevant safe checks, normally:
- npm run lint
- npm run typecheck
- npm run test
- npm run build

Run focused or E2E checks when relevant and already configured.

Do not hide failures and do not weaken tests/configuration just to make checks pass.
If a failure is caused by the current work, fix it within scope and rerun.
If it is pre-existing or outside scope, report it clearly.
Do not commit or push.
