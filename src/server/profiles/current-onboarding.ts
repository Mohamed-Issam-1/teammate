import "server-only";

import { requireServerSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getOnboardingStateForSession } from "./onboarding";

/** Read onboarding state for the current server-authenticated user. */
export async function getCurrentOnboardingState() {
  const session = await requireServerSession();
  return getOnboardingStateForSession(session, prisma);
}
