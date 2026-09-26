import "server-only";

import { requireServerSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  addOwnInterest,
  listOwnInterestAssignments,
  listOwnSkillAssignments,
  removeOwnInterest,
  removeOwnSkillAssignment,
  saveOwnSkillAssignment,
  type AssignedInterest,
  type AssignedSkill,
} from "./assignments";

/**
 * Runtime own-assignment access for the current server-authenticated user.
 *
 * The session is resolved here, so no page or action can supply a user id.
 */

export async function getCurrentSkillAssignments(): Promise<AssignedSkill[]> {
  const session = await requireServerSession();
  return listOwnSkillAssignments(session, prisma);
}

export async function getCurrentInterestAssignments(): Promise<
  AssignedInterest[]
> {
  const session = await requireServerSession();
  return listOwnInterestAssignments(session, prisma);
}

export async function saveCurrentSkillAssignment(
  input: unknown,
): Promise<AssignedSkill & { updated: boolean }> {
  const session = await requireServerSession();
  return saveOwnSkillAssignment(session, input, prisma);
}

export async function removeCurrentSkillAssignment(input: unknown): Promise<{
  skillId: string;
}> {
  const session = await requireServerSession();
  return removeOwnSkillAssignment(session, input, prisma);
}

export async function addCurrentInterest(
  input: unknown,
): Promise<AssignedInterest> {
  const session = await requireServerSession();
  return addOwnInterest(session, input, prisma);
}

export async function removeCurrentInterest(input: unknown): Promise<{
  interestId: string;
}> {
  const session = await requireServerSession();
  return removeOwnInterest(session, input, prisma);
}
