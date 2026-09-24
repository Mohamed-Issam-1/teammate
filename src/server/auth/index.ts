import "server-only";

import { prisma } from "@/server/db";
import { authEmail } from "@/server/email";

import { authEnv } from "./env";
import { createAuth } from "./factory";

/**
 * Runtime Better Auth instance.
 *
 * Runtime-only concerns—secret, Prisma adapter, and the server-only email
 * boundary—are composed here rather than in the CLI-safe options module.
 */
export const auth = createAuth({
  baseURL: authEnv.BETTER_AUTH_URL,
  database: prisma,
  email: authEmail,
  secret: authEnv.BETTER_AUTH_SECRET,
});
