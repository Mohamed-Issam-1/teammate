# Data Model

This document defines the intended domain model. The Prisma schema is the executable representation and must stay consistent with this document.

## Identity

Better Auth owns its required user/session/account/verification tables.

TeamMate adds application-specific profile/domain tables keyed to the auth user ID.

## Profile

`Profile`
- userId (unique FK)
- displayName
- headline
- bio
- avatarUrl
- availabilityHoursPerWeek
- timezone
- profileVisibility
- onboardingCompletedAt
- createdAt / updatedAt

### Phase 1 implemented subset

Phase 1 implements only `userId`, `displayName`, `onboardingCompletedAt`,
`createdAt`, and `updatedAt`. Every remaining field above is Phase 2 scope and
does not exist yet. The single migration is
`20260924082555_auth_onboarding_foundation`.

`Profile.displayName` is the canonical display name for the account. The signup
name is only the starting value offered on `/onboarding`; it is not a separate
field and does not survive a later display-name change.

Onboarding derives the user identity from the session only. There is no
user-ID parameter anywhere in the path, the input schema is `.strict()` so
unknown fields are rejected rather than ignored, and the completion write is
guarded on `onboardingCompletedAt: null` inside a transaction, so a replayed or
duplicated submission cannot rewrite a completed timestamp or replace the
canonical display name.

## Skills

`Skill`
- id
- slug (unique)
- name (unique/canonical)
- category optional

`UserSkill`
- userId
- skillId
- proficiencyLevel (bounded)
- yearsExperience optional
- unique(userId, skillId)

## Interests

`Interest`
- id
- slug
- name

`UserInterest`
- userId
- interestId
- unique pair

## Projects

`Project`
- id
- ownerId
- title
- slug or public identifier
- summary
- description
- visibility
- status
- desiredTeamSize
- expectedHoursPerWeek optional
- createdAt / updatedAt / archivedAt optional

Indexes should support owner, status, visibility, createdAt.

`ProjectRequiredSkill`
- projectId
- skillId
- importance/weight
- minimumProficiency optional
- unique pair

`ProjectInterest`
- projectId
- interestId
- unique pair

## Membership

`ProjectMember`
- projectId
- userId
- role: OWNER | MANAGER | MEMBER
- joinedAt
- unique(projectId, userId)

Invariant: each non-archived project has exactly one owner membership aligned with `Project.ownerId`, unless a later ADR changes this representation.

## Applications

`ProjectApplication`
- id
- projectId
- applicantId
- message optional
- status
- createdAt
- decidedAt optional
- decidedById optional

Prevent duplicate active/pending applications at the database/business-rule level.

## Invitations

`ProjectInvitation`
- id
- projectId
- inviteeId
- invitedById
- message optional
- status
- expiresAt
- createdAt
- respondedAt optional

Prevent duplicate active pending invitations.

## Workspace

`BoardColumn`
- id
- projectId
- name
- position
- protected/system flag if needed

`Task`
- id
- projectId
- columnId
- title
- description
- priority
- dueAt optional
- position
- createdById
- createdAt / updatedAt

`TaskAssignee`
- taskId
- userId
- unique pair

Assignees must be current project members.

## Files

`Attachment`
- id
- uploaderId
- projectId optional
- taskId optional
- storageKey
- originalName
- mimeType
- sizeBytes
- createdAt
- deletedAt optional

The storage key is generated server-side.

## Notifications

`Notification`
- id
- userId
- type
- title
- body or structured payload
- resourceType/resourceId where safe
- readAt optional
- createdAt

Index `(userId, readAt, createdAt)` or an equivalent query-friendly arrangement.

## Activity/audit

`ActivityLog`
- id
- projectId optional
- actorId optional
- eventType
- targetType
- targetId
- metadata JSON with controlled contents
- createdAt

`AdminAction` may be separate if admin audit requirements diverge from normal project activity.

Never place secrets or raw credentials in metadata JSON.

## AI matching

`AiMatchRun`
- id
- requesterId
- projectId
- algorithmVersion
- provider/model metadata as non-secret identifiers
- candidateCount
- token/cost metadata where available
- createdAt

`AiMatchCandidate`
- runId
- candidateUserId
- skillScore
- interestScore
- availabilityScore
- otherScore
- finalScore
- explanation optional
- rank
- unique(runId, candidateUserId)

## General database rules

- Use foreign keys.
- Add indexes for actual query patterns.
- Add unique constraints to defend invariants.
- Do not depend only on UI checks.
- Use transactions for state transitions.
- Prefer archival/status changes to destructive deletion when history matters.
- Migrations are append-only and reviewed; no reset-based workflow.
