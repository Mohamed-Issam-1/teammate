import type { PrismaClient } from "@/generated/prisma/client";
import { requireActiveVerifiedSession } from "@/server/auth/policy";

/**
 * Read-only taxonomy boundary.
 *
 * These lists exist to back authenticated profile editing, so the ACTIVE +
 * verified session policy is enforced here at the application boundary. There is
 * deliberately no create, update, or delete path: taxonomy is system-managed.
 *
 * Only the fields a future selection UI needs are returned, and Prisma rows are
 * never handed to a client wholesale.
 */

export type TaxonomyReadDatabase = Pick<PrismaClient, "skill" | "interest">;

export type TaxonomySkill = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
};

export type TaxonomyInterest = {
  id: string;
  slug: string;
  name: string;
};

export type TaxonomySession = {
  user: {
    id: string;
    accountStatus: string;
    emailVerified: boolean;
  };
};

/**
 * List all skills in deterministic presentation order: category, then name.
 *
 * A null category sorts last under the default PostgreSQL ordering, so the
 * sequence is stable. No order column exists in the database.
 */
export async function listTaxonomySkills(
  session: TaxonomySession | null,
  database: TaxonomyReadDatabase,
): Promise<TaxonomySkill[]> {
  requireActiveVerifiedSession(session);

  const rows = await database.skill.findMany({
    select: { id: true, slug: true, name: true, category: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return rows;
}

/** List all interests in deterministic order by name. */
export async function listTaxonomyInterests(
  session: TaxonomySession | null,
  database: TaxonomyReadDatabase,
): Promise<TaxonomyInterest[]> {
  requireActiveVerifiedSession(session);

  const rows = await database.interest.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });

  return rows;
}
