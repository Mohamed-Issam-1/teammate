---
description: Check project documentation for drift after implementation and update only what is needed.
agent: build
---

Read the current changes plus:
- docs/00_SOURCE_OF_TRUTH.md
- docs/STATUS.md
- relevant architecture/SRS/security/data documents
- relevant ADRs

Identify documentation that is now inaccurate because of the current implementation.

Update documentation only where behavior, architecture, security, data model, setup, or roadmap status actually changed.
Do not rewrite documents cosmetically.
Do not mark planned behavior as completed unless it exists and was verified.
Do not commit or push.
