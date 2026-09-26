import "server-only";

import { requireServerSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  listTaxonomyInterests,
  listTaxonomySkills,
  type TaxonomyInterest,
  type TaxonomySkill,
} from "./reads";

/**
 * Runtime taxonomy reads for the current server-authenticated user.
 *
 * The session is resolved here, so no caller can supply a user identifier.
 */

export async function getCurrentTaxonomySkills(): Promise<TaxonomySkill[]> {
  const session = await requireServerSession();
  return listTaxonomySkills(session, prisma);
}

export async function getCurrentTaxonomyInterests(): Promise<
  TaxonomyInterest[]
> {
  const session = await requireServerSession();
  return listTaxonomyInterests(session, prisma);
}
