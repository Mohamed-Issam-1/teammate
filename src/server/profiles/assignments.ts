import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  addInterestAssignmentSchema,
  removeInterestAssignmentSchema,
  removeSkillAssignmentSchema,
  saveSkillAssignmentSchema,
  type AddInterestAssignmentInput,
  type RemoveInterestAssignmentInput,
  type RemoveSkillAssignmentInput,
  type SaveSkillAssignmentInput,
} from "@/features/profile/assignment-validation";
import { requireActiveVerifiedSession } from "@/server/auth/policy";

/**
 * Own skill/interest assignment boundary.
 *
 * Every function is session-scoped: the user identity comes only from the
 * authenticated session, and none accepts a user identifier from a caller. The
 * database contract deliberately exposes only `findUnique` on `skill` and
 * `interest`, so taxonomy cannot be created, renamed, recategorized, or deleted
 * from this module even by mistake — assignments are the only writable rows here.
 *
 * Onboarding completion is a precondition read rather than part of the write,
 * because `UserSkill`/`UserInterest` have no onboarding column. Completion is
 * monotonic in Phase 1 — the guarded onboarding update only ever completes and
 * nothing reverses it — so a read-then-write cannot produce an invalid state.
 */

export type OwnAssignmentDatabase = {
  profile: Pick<PrismaClient["profile"], "findUnique">;
  skill: Pick<PrismaClient["skill"], "findUnique">;
  interest: Pick<PrismaClient["interest"], "findUnique">;
  userSkill: Pick<
    PrismaClient["userSkill"],
    "findMany" | "findUnique" | "upsert" | "deleteMany"
  >;
  userInterest: Pick<
    PrismaClient["userInterest"],
    "findMany" | "createMany" | "deleteMany"
  >;
};

export type OwnAssignmentSession = {
  user: { id: string; accountStatus: string; emailVerified: boolean };
};

/** Selected taxonomy is missing or was removed. Taxonomy is shared system data. */
export class TaxonomyEntryUnavailableError extends Error {
  constructor(kind: "skill" | "interest") {
    super(`Selected ${kind} is unavailable`);
    this.name = "TaxonomyEntryUnavailableError";
    this.kind = kind;
  }

  readonly kind: "skill" | "interest";
}

export class InvalidAssignmentInputError extends Error {
  constructor() {
    super("Invalid assignment input");
    this.name = "InvalidAssignmentInputError";
  }
}

export class AssignmentNotOnboardedError extends Error {
  constructor() {
    super("Profile onboarding is not complete");
    this.name = "AssignmentNotOnboardedError";
  }
}

export type AssignedSkill = {
  skillId: string;
  slug: string;
  name: string;
  category: string | null;
  proficiencyLevel: string;
  yearsExperience: number | null;
};

export type AssignedInterest = {
  interestId: string;
  slug: string;
  name: string;
};

/** Resolve the session user, or throw the appropriate fail-closed policy error. */
function requireOwnedIdentity(session: OwnAssignmentSession | null): string {
  return requireActiveVerifiedSession(session).user.id;
}

/**
 * Compare two optional categories, sorting null last.
 *
 * PostgreSQL's `ASC` default places NULLs last, so an empty-string substitution
 * would be wrong: it would float uncategorized skills to the top instead of the
 * bottom of the list.
 */
function compareNullableCategory(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a.localeCompare(b);
}

/** Confirm onboarding completed, since assignments are only meaningful then. */
async function requireOnboarded(
  userId: string,
  database: Pick<OwnAssignmentDatabase, "profile">,
): Promise<void> {
  const profile = await database.profile.findUnique({
    where: { userId },
    select: { onboardingCompletedAt: true },
  });

  if (profile === null || profile.onboardingCompletedAt === null) {
    throw new AssignmentNotOnboardedError();
  }
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own skill assignments, ordered by category then name.
 *
 * A null category sorts last, matching the PostgreSQL `ASC` default and the
 * taxonomy read boundary, so an uncategorized skill appears after categorized
 * ones in both lists.
 */
export async function listOwnSkillAssignments(
  session: OwnAssignmentSession | null,
  database: OwnAssignmentDatabase,
): Promise<AssignedSkill[]> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const rows = await database.userSkill.findMany({
    where: { userId },
    select: {
      proficiencyLevel: true,
      yearsExperience: true,
      skill: { select: { id: true, slug: true, name: true, category: true } },
    },
  });

  return rows
    .map((row) => ({
      skillId: row.skill.id,
      slug: row.skill.slug,
      name: row.skill.name,
      category: row.skill.category,
      proficiencyLevel: row.proficiencyLevel,
      yearsExperience: row.yearsExperience,
    }))
    .sort((a, b) => {
      const byCategory = compareNullableCategory(a.category, b.category);
      return byCategory === 0 ? a.name.localeCompare(b.name) : byCategory;
    });
}

/**
 * Create or update the caller's own assignment for one skill.
 *
 * Uses the `(userId, skillId)` unique key as the upsert target, so submitting
 * the same skill again updates the existing assignment instead of creating a
 * duplicate, and two concurrent saves still leave exactly one row.
 */
export async function saveOwnSkillAssignment(
  session: OwnAssignmentSession | null,
  input: unknown,
  database: OwnAssignmentDatabase,
): Promise<AssignedSkill & { updated: boolean }> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const parsed = saveSkillAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidAssignmentInputError();
  }

  const { skillId, proficiencyLevel, yearsExperience } = parsed.data;

  const skill = await database.skill.findUnique({
    where: { id: skillId },
    select: { id: true, slug: true, name: true, category: true },
  });

  if (skill === null) {
    throw new TaxonomyEntryUnavailableError("skill");
  }

  // An indexed read on the composite unique key, so the UI can report an update
  // rather than an add without a second list query.
  const existing = await database.userSkill.findUnique({
    where: { userId_skillId: { userId, skillId } },
    select: { userId: true },
  });

  await database.userSkill.upsert({
    where: { userId_skillId: { userId, skillId } },
    create: { userId, skillId, proficiencyLevel, yearsExperience },
    update: { proficiencyLevel, yearsExperience },
    select: { userId: true },
  });

  return {
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    proficiencyLevel,
    yearsExperience,
    updated: existing !== null,
  };
}

/**
 * Remove one of the caller's own skill assignments.
 *
 * A scoped `deleteMany` on both `userId` and `skillId` means this can never
 * delete a `Skill` taxonomy row, and can never touch another user's
 * assignment. Removing an absent assignment is an idempotent success.
 */
export async function removeOwnSkillAssignment(
  session: OwnAssignmentSession | null,
  input: unknown,
  database: OwnAssignmentDatabase,
): Promise<{ skillId: string }> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const parsed = removeSkillAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidAssignmentInputError();
  }

  await database.userSkill.deleteMany({
    where: { userId, skillId: parsed.data.skillId },
  });

  return { skillId: parsed.data.skillId };
}

/* -------------------------------------------------------------------------- */
/* Interests                                                                   */
/* -------------------------------------------------------------------------- */

/** The caller's own interest assignments, ordered by name. */
export async function listOwnInterestAssignments(
  session: OwnAssignmentSession | null,
  database: OwnAssignmentDatabase,
): Promise<AssignedInterest[]> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const rows = await database.userInterest.findMany({
    where: { userId },
    select: {
      interest: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { interest: { name: "asc" } },
  });

  return rows.map((row) => ({
    interestId: row.interest.id,
    slug: row.interest.slug,
    name: row.interest.name,
  }));
}

/**
 * Add one of the caller's own interest assignments, idempotently.
 *
 * `createMany` with `skipDuplicates` relies on the `(userId, interestId)`
 * unique constraint, so an already-assigned interest and a concurrent add both
 * leave exactly one row rather than raising.
 */
export async function addOwnInterest(
  session: OwnAssignmentSession | null,
  input: unknown,
  database: OwnAssignmentDatabase,
): Promise<AssignedInterest> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const parsed = addInterestAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidAssignmentInputError();
  }

  const interest = await database.interest.findUnique({
    where: { id: parsed.data.interestId },
    select: { id: true, slug: true, name: true },
  });

  if (interest === null) {
    throw new TaxonomyEntryUnavailableError("interest");
  }

  await database.userInterest.createMany({
    data: [{ userId, interestId: interest.id }],
    skipDuplicates: true,
  });

  return {
    interestId: interest.id,
    slug: interest.slug,
    name: interest.name,
  };
}

/** Remove one of the caller's own interest assignments. Never deletes taxonomy. */
export async function removeOwnInterest(
  session: OwnAssignmentSession | null,
  input: unknown,
  database: OwnAssignmentDatabase,
): Promise<{ interestId: string }> {
  const userId = requireOwnedIdentity(session);
  await requireOnboarded(userId, database);

  const parsed = removeInterestAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidAssignmentInputError();
  }

  await database.userInterest.deleteMany({
    where: { userId, interestId: parsed.data.interestId },
  });

  return { interestId: parsed.data.interestId };
}

export type {
  AddInterestAssignmentInput,
  RemoveInterestAssignmentInput,
  RemoveSkillAssignmentInput,
  SaveSkillAssignmentInput,
};
