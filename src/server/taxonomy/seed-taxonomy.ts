import type { PrismaClient } from "@/generated/prisma/client";
import {
  validateStarterTaxonomy,
  type TaxonomyDefinitionProblem,
} from "./normalize";
import {
  starterInterests,
  starterSkills,
  type StarterInterest,
  type StarterSkill,
} from "./starter-taxonomy";

/**
 * Idempotent, non-destructive starter taxonomy seeding.
 *
 * Taxonomy is system-managed, so this command only ever inserts rows that are
 * missing. It never updates, renames, recategorizes, or deletes an existing
 * taxonomy row, and it never touches `UserSkill` or `UserInterest`. If existing
 * rows disagree with the starter set on `slug`, `name`, or `nameKey`, the command
 * fails closed and reports the conflict instead of rewriting data.
 */

/**
 * The narrowest database contract the seed needs.
 *
 * `update`, `updateMany`, `delete`, and `deleteMany` are deliberately absent, so
 * non-destructiveness is enforced by the type rather than by review. The join
 * models are absent for the same reason: the seed can never touch user
 * assignments.
 */
export type TaxonomySeedDatabase = {
  skill: Pick<PrismaClient["skill"], "findMany" | "createMany" | "count">;
  interest: Pick<PrismaClient["interest"], "findMany" | "createMany" | "count">;
};

export type TaxonomyConflict = {
  kind: "skill" | "interest";
  slug: string;
  /** Which field disagreed. Never contains a value. */
  field: "slug" | "name" | "nameKey";
};

export type TaxonomySeedResult = {
  skillsInserted: number;
  interestsInserted: number;
  skillsSkipped: number;
  interestsSkipped: number;
  totalSkills: number;
  totalInterests: number;
};

export class InvalidStarterTaxonomyError extends Error {
  readonly problems: readonly TaxonomyDefinitionProblem[];

  constructor(problems: readonly TaxonomyDefinitionProblem[]) {
    super("Starter taxonomy definition is invalid");
    this.name = "InvalidStarterTaxonomyError";
    this.problems = problems;
  }
}

export class TaxonomyConflictError extends Error {
  readonly conflicts: readonly TaxonomyConflict[];

  constructor(conflicts: readonly TaxonomyConflict[]) {
    super("Existing taxonomy conflicts with the starter taxonomy");
    this.name = "TaxonomyConflictError";
    this.conflicts = conflicts;
  }
}

type TaxonomyIdentity = { slug: string; name: string; nameKey: string };
type IdentifiedRow = TaxonomyIdentity & { id: string };

/**
 * Classify each starter entry against existing rows.
 *
 * An entry is "already present" only when the row found by curated slug agrees on
 * both display name and normalized key. Anything else is either a conflict — which
 * stops the run — or genuinely missing, which is inserted.
 */
function classify<T extends TaxonomyIdentity>(
  kind: "skill" | "interest",
  desired: readonly T[],
  existing: readonly IdentifiedRow[],
): { missing: T[]; present: number; conflicts: TaxonomyConflict[] } {
  const bySlug = new Map(existing.map((row) => [row.slug, row] as const));
  const byName = new Map(existing.map((row) => [row.name, row] as const));
  const byNameKey = new Map(existing.map((row) => [row.nameKey, row] as const));

  const missing: T[] = [];
  const conflicts: TaxonomyConflict[] = [];
  let present = 0;

  for (const entry of desired) {
    const slugMatch = bySlug.get(entry.slug);

    if (slugMatch) {
      // The curated slug is taken. Agreeing on name and key means it is already
      // seeded; anything else is an inconsistency we must not rewrite.
      if (
        slugMatch.name === entry.name &&
        slugMatch.nameKey === entry.nameKey
      ) {
        present += 1;
      } else {
        if (slugMatch.name !== entry.name) {
          conflicts.push({ kind, slug: entry.slug, field: "name" });
        }
        if (slugMatch.nameKey !== entry.nameKey) {
          conflicts.push({ kind, slug: entry.slug, field: "nameKey" });
        }
      }
      continue;
    }

    // The slug is free, but the display name or key is already claimed by a
    // different entry. Inserting would either fail on a unique constraint or
    // create a duplicate, so stop instead.
    if (byName.has(entry.name)) {
      conflicts.push({ kind, slug: entry.slug, field: "name" });
      continue;
    }

    if (byNameKey.has(entry.nameKey)) {
      conflicts.push({ kind, slug: entry.slug, field: "nameKey" });
      continue;
    }

    missing.push(entry);
  }

  return { missing, present, conflicts };
}

/**
 * Seed the curated starter taxonomy.
 *
 * Safe to run repeatedly. Existing rows and user assignments are never modified
 * or removed.
 *
 * @throws {InvalidStarterTaxonomyError} when the in-memory definition is invalid
 * @throws {TaxonomyConflictError} when existing rows disagree with the starter set
 */
export async function seedStarterTaxonomy(
  database: TaxonomySeedDatabase,
): Promise<TaxonomySeedResult> {
  const definitionProblems = validateStarterTaxonomy(
    starterSkills,
    starterInterests,
  );
  if (definitionProblems.length > 0) {
    throw new InvalidStarterTaxonomyError(definitionProblems);
  }

  const [existingSkills, existingInterests] = await Promise.all([
    database.skill.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        nameKey: true,
        // `category` is intentionally not selected: a row that already agrees on
        // identity is left exactly as-is, so a curated category change is never
        // applied retroactively to existing rows.
      },
    }),
    database.interest.findMany({
      select: { id: true, slug: true, name: true, nameKey: true },
    }),
  ]);

  const skillPlan = classify<StarterSkill>(
    "skill",
    starterSkills,
    existingSkills,
  );
  const interestPlan = classify<StarterInterest>(
    "interest",
    starterInterests,
    existingInterests,
  );

  const conflicts = [...skillPlan.conflicts, ...interestPlan.conflicts];
  if (conflicts.length > 0) {
    throw new TaxonomyConflictError(conflicts);
  }

  // `skipDuplicates` emits ON CONFLICT DO NOTHING, so a row that appeared
  // between the pre-check and this write is skipped rather than aborting the run.
  // It is not a substitute for the conflict pre-check above, which is what
  // guarantees an inconsistent existing row is reported instead of silently
  // skipped.
  const [skillInsert, interestInsert] = await Promise.all([
    skillPlan.missing.length > 0
      ? database.skill.createMany({
          data: skillPlan.missing.map(({ slug, name, nameKey, category }) => ({
            slug,
            name,
            nameKey,
            category,
          })),
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
    interestPlan.missing.length > 0
      ? database.interest.createMany({
          data: interestPlan.missing.map(({ slug, name, nameKey }) => ({
            slug,
            name,
            nameKey,
          })),
          skipDuplicates: true,
        })
      : Promise.resolve({ count: 0 }),
  ]);

  const [totalSkills, totalInterests] = await Promise.all([
    database.skill.count(),
    database.interest.count(),
  ]);

  return {
    skillsInserted: skillInsert.count,
    interestsInserted: interestInsert.count,
    skillsSkipped: skillPlan.present,
    interestsSkipped: interestPlan.present,
    totalSkills,
    totalInterests,
  };
}
