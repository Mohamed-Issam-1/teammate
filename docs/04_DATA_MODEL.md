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

### Current implemented columns

`Profile` currently has: `userId` (primary key), `displayName`, `headline`,
`bio`, `avatarUrl`, `availabilityHoursPerWeek`, `timezone`, `profileVisibility`,
`onboardingCompletedAt`, `createdAt`, `updatedAt`.

`headline`, `bio`, `avatarUrl`, `availabilityHoursPerWeek`, and `timezone` are
nullable. `profileVisibility` is non-null and defaults to `PRIVATE`.
`avatarUrl` is written by a trusted server-side upload boundary; it is not
synchronized with the Better Auth `User.image` field.

Migrations: `20260924082555_auth_onboarding_foundation` and
`20260926090638_phase2_profiles_and_taxonomy`. The second migration is additive
only.

`Profile.displayName` is the canonical display name for the account. The signup
name is only the starting value offered on `/onboarding`; it is not a separate
field and does not survive a later display-name change.

Onboarding derives the user identity from the session only. There is no
user-ID parameter anywhere in the path, the input schema is `.strict()` so
unknown fields are rejected rather than ignored, and the completion write is
guarded on `onboardingCompletedAt: null` inside a transaction, so a replayed or
duplicated submission cannot rewrite a completed timestamp or replace the
canonical display name.

## Own profile

`/app/profile` exposes a session-scoped read and write boundary. Neither
function accepts a user identifier: the identity always comes from the
authenticated session, which is what makes cross-user access structurally
impossible rather than merely validated against.

Editable fields are `displayName`, `headline`, `bio`,
`availabilityHoursPerWeek`, `timezone`, and `profileVisibility`. Server-side
validation is authoritative and the Prisma payload is an explicit object, so
`avatarUrl`, `userId`, `onboardingCompletedAt`, and the auth-owned `User` fields
cannot be written through this path. `avatarUrl` is server-owned and has no
write path until a trusted upload/storage boundary exists.

`availabilityHoursPerWeek` is validated to the inclusive range 0–168. The
column is a plain integer with no database CHECK, so the server boundary is the
only control.

`profileVisibility` is stored and editable but is not yet read by any
projector, because the public profile route is deferred. `timezone` is validated
against the runtime's IANA time-zone database via `Intl.DateTimeFormat`.

A missing `Profile` row means the account has not completed onboarding, since
onboarding is the only path that creates one. Such a session is routed to
`/onboarding` rather than being given a manufactured profile.

## Skills

`Skill`
- id (`@default(uuid())`, Prisma-generated; the column has no database default)
- slug (unique)
- name (unique/canonical)
- nameKey (unique; the case-insensitive normalized key)
- category optional

`UserSkill`
- userId
- skillId
- proficiencyLevel (`ProficiencyLevel` enum)
- yearsExperience optional
- unique(userId, skillId)
- index(skillId)
- `userId` cascades on user deletion; `skillId` is restricted while referenced

No `createdAt`/`updatedAt` on either model; timestamps are specified per entity
and are not part of the taxonomy design.

## Interests

`Interest`
- id (`@default(uuid())`, Prisma-generated)
- slug (unique)
- nameKey (unique)
- name
- index-free; `UserInterest` carries the reverse index

`UserInterest`
- userId
- interestId
- unique(userId, interestId)
- index(interestId)
- `userId` cascades on user deletion; `interestId` is restricted while referenced

## Taxonomy invariants

- Taxonomy is system-managed. No application surface — server action, route, or
  API — lets an ordinary user create, rename, recategorize, or delete a `Skill`
  or `Interest`. Ordinary users may read the taxonomy and, in a later checkpoint,
  assign existing entries to themselves. Admin management is a later phase.
- `name` uniqueness is case-sensitive under the default PostgreSQL collation.
  The `nameKey` unique constraint is what prevents `React` and `react` from
  coexisting, and only when both rows store the same normalized key.
- The database performs no normalization. Deriving `nameKey` and validating
  `slug` is a server-side responsibility.
- Deleting a user cascades to their join rows only. Shared taxonomy rows are
  never deleted as a side effect.

### Normalization contract

`nameKey` is derived, never hand-written, in this exact order:

1. Unicode NFC normalization;
2. trim leading and trailing whitespace;
3. collapse internal whitespace runs to a single ASCII space;
4. lowercase.

This is deterministic lowercase normalization only. It is **not** Unicode full
case folding, **not** homoglyph or confusable detection, and **not** fuzzy
matching or semantic aliasing. A Cyrillic homoglyph is not folded onto its Latin
counterpart. `React` and `react` produce the same key; `React` and `React.js`
remain distinct.

### Slug contract

Slugs are curated explicitly and are never derived from a display name, so
`C++` maps to the curated `cpp`. The grammar is
`^[a-z0-9]+(?:-[a-z0-9]+)*$`: lowercase alphanumeric groups joined by single
hyphens. Uppercase, underscores, repeated hyphens, leading or trailing hyphens,
whitespace, and non-ASCII characters are all rejected. Display names themselves
may contain Unicode. No transliteration dependency is used.

### Starter taxonomy

The starter taxonomy is **product-owned seed content** authored for this
repository and approved as the Phase 2 baseline. It is not derived from, and does
not claim to represent, any external standards body or third-party ontology.

`npm run seed:taxonomy` inserts the curated starter set. It is safe to run
repeatedly: it only inserts rows that are missing, never updates or deletes an
existing taxonomy row, and never touches `UserSkill` or `UserInterest`. If
existing rows disagree with the starter set on `slug`, `name`, or `nameKey`, the
command fails closed and reports the conflict instead of rewriting data. A row
whose name and key agree but whose category differs is left untouched. The
command targets the database named by `DATABASE_URL`, and never migrates,
resets, pushes, or drops anything.

### Presentation ordering

Skills are listed by category then name; interests by name. A null skill category
sorts last. No order column exists in the database.

### Read projection

The read boundaries return only `id`, `slug`, `name`, and `category` for skills,
and `id`, `slug`, and `name` for interests. `nameKey` is never exposed, and no
Prisma row is passed to a client wholesale. Reads require an ACTIVE and verified
session, because in Phase 2 they exist only to back authenticated profile
editing.

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
