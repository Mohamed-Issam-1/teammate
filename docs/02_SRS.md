# Software Requirements Specification — TeamMate

Requirement IDs are stable references for implementation/tests.

## A. Authentication

- **AUTH-001** User can register with email and password.
- **AUTH-002** Duplicate email registration is rejected safely.
- **AUTH-003** User must verify email before protected collaboration actions.
- **AUTH-004** User can sign in and sign out.
- **AUTH-005** User can request password reset without account-enumeration leakage.
- **AUTH-006** Reset tokens expire and are single-use.
- **AUTH-007** Protected pages/actions reject unauthenticated access server-side.
- **AUTH-008** Suspended users cannot use protected collaboration capabilities.

## B. Profile

- **PRO-001** User can create/edit profile.
- **PRO-002** Profile supports display name, headline, bio, avatar.
- **PRO-003** User can add/remove skills and proficiency.
- **PRO-004** User can add/remove interests.
- **PRO-005** User can specify availability.
- **PRO-006** Public profile exposes only intended public fields.
- **PRO-007** Profile input is validated server-side.

## C. Projects

- **PRJ-001** Verified user can create a project.
- **PRJ-002** Owner can edit project.
- **PRJ-003** Project defines required skills and desired team size.
- **PRJ-004** Project has explicit lifecycle state.
- **PRJ-005** Unauthorized users cannot mutate a project.
- **PRJ-006** Project can be archived without deleting audit history.
- **PRJ-007** Project detail displays team/application actions appropriate to viewer state.

## D. Applications

- **APP-001** Eligible user can apply to an open project.
- **APP-002** Duplicate pending application is prevented.
- **APP-003** Member cannot apply to a project they already joined.
- **APP-004** Applicant can withdraw a pending application.
- **APP-005** Owner/manager can accept/reject pending applications.
- **APP-006** Acceptance creates membership atomically.
- **APP-007** Decisions generate notifications/activity events.

## E. Invitations

- **INV-001** Owner/manager can invite an eligible user.
- **INV-002** Duplicate pending invitation is prevented.
- **INV-003** Invitee can accept/decline.
- **INV-004** Sender can revoke pending invitation when policy allows.
- **INV-005** Expired invitation cannot be accepted.
- **INV-006** Acceptance creates membership atomically.
- **INV-007** Invitation actions generate notifications/activity.

## F. Membership and roles

- **MEM-001** Project membership has explicit role.
- **MEM-002** Only authorized roles can change membership roles.
- **MEM-003** Owner-only operations cannot be performed by managers/members.
- **MEM-004** Project cannot be left without an owner.
- **MEM-005** Removing/leaving membership follows defined policy and audit logging.

## G. Workspace/tasks

- **WRK-001** Members can view workspace.
- **WRK-002** Authorized users can create/update/reorder tasks.
- **WRK-003** Tasks support title, description, assignees, priority, due date, column.
- **WRK-004** Kanban columns have stable ordering.
- **WRK-005** Non-members cannot access private workspace data.
- **WRK-006** Material task changes create activity entries.

## H. Notifications

- **NOT-001** Important domain events create in-app notifications.
- **NOT-002** User can mark notification read/unread.
- **NOT-003** Notification deep-links to authorized resource.
- **NOT-004** High-value events may send email asynchronously.
- **NOT-005** Notification payload never leaks protected resource information.

## I. Search/discovery

- **SRC-001** User can search projects.
- **SRC-002** User can filter by relevant skill/interest/state attributes.
- **SRC-003** User can discover people allowed by privacy rules.
- **SRC-004** Results are paginated.
- **SRC-005** Search does not bypass resource visibility rules.

## J. Attachments

- **FIL-001** Authorized user can request an upload.
- **FIL-002** Server validates file metadata/limits.
- **FIL-003** Storage key cannot be chosen to overwrite arbitrary objects.
- **FIL-004** Attachment ownership/context is recorded.
- **FIL-005** Download/view respects authorization.
- **FIL-006** Deletion is auditable where appropriate.

## K. AI matching

- **AI-001** Authorized user can request candidate suggestions for a project.
- **AI-002** Only eligible/discoverable users may enter candidate set.
- **AI-003** Matching produces component scores and final score.
- **AI-004** Explanation is clearly advisory.
- **AI-005** AI cannot change membership/application/invitation state.
- **AI-006** Requests are rate/cost limited.
- **AI-007** Sensitive/private data is not sent unnecessarily.
- **AI-008** Failed AI provider call does not break core team formation.

## L. Admin

- **ADM-001** Admin routes/actions require global ADMIN role.
- **ADM-002** Admin can search users/projects.
- **ADM-003** Admin can suspend/restore users with audit record.
- **ADM-004** Admin moderation actions record actor, target, reason, time.
- **ADM-005** Admin UI does not expose secrets/auth credentials.

## Non-functional requirements

- **NFR-001 Security:** OWASP-aware controls and authorization tests for protected flows.
- **NFR-002 Reliability:** multi-write state transitions use transactions.
- **NFR-003 Accessibility:** keyboard/focus/semantic form support; WCAG-minded implementation.
- **NFR-004 Responsiveness:** all core flows usable on small mobile and desktop.
- **NFR-005 Performance:** pagination, indexes, no obvious N+1 query patterns.
- **NFR-006 Maintainability:** strict TypeScript, modular boundaries, documented decisions.
- **NFR-007 Observability:** production errors and privileged actions are diagnosable.
- **NFR-008 Portability:** provider-specific services are wrapped behind small boundaries.
- **NFR-009 Testability:** core domain behavior can be exercised without browser-only tests.
