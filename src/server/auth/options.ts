import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";

import { safeAuthLogger } from "./logger";

/**
 * CLI-safe Better Auth options.
 *
 * This module contains no Prisma singleton, `server-only` import, Next.js
 * request API, provider SDK, secret, or browser code. Runtime-only concerns
 * are composed in `src/server/auth/index.ts`.
 */

export const GLOBAL_ROLES = ["USER", "ADMIN"] as const;
export const ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export type GlobalRole = (typeof GLOBAL_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type AuthEmailOperations = {
  sendVerificationEmail: (input: { to: string; url: string }) => Promise<void>;
  sendPasswordResetEmail: (input: { to: string; url: string }) => Promise<void>;
};

export type AuthOptionsInput = {
  baseURL: string;
  email: AuthEmailOperations;
};

type UserLookup = (userId: string) => Promise<unknown>;

function sessionCreationError(): APIError {
  return APIError.from("FORBIDDEN", {
    code: "SESSION_CREATION_NOT_ALLOWED",
    message: "Session could not be created.",
  });
}

function isKnownActiveUser(user: unknown): boolean {
  return (
    typeof user === "object" &&
    user !== null &&
    "accountStatus" in user &&
    user.accountStatus === "ACTIVE"
  );
}

/**
 * Require an authoritative ACTIVE-user lookup before Better Auth persists a
 * session. All uncertainty is deliberately collapsed into one generic error so
 * database failures and account-state details cannot reach the public response.
 */
export async function requireActiveUserForSessionCreation(
  userId: string,
  findUserById: UserLookup,
): Promise<void> {
  try {
    const user = await findUserById(userId);
    if (isKnownActiveUser(user)) {
      return;
    }
  } catch {
    // Fail closed without logging a raw framework or database exception.
  }

  throw sessionCreationError();
}

/**
 * Build the Better Auth options shared by the CLI and runtime entrypoints.
 * The runtime entry supplies the secret and Prisma adapter separately.
 */
export function createAuthOptions({ baseURL, email }: AuthOptionsInput) {
  const trustedOrigin = new URL(baseURL).origin;

  const authOptions = {
    appName: "TeamMate",
    baseURL,
    trustedOrigins: [trustedOrigin],
    logger: safeAuthLogger,
    onAPIError: {
      throw: true,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Better Auth 1.7.5 does not guarantee one transaction spanning token
      // consumption, password update, and session revocation. Phase 1 accepts
      // this native-flow limitation as an upstream residual risk.
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await email.sendPasswordResetEmail({
          to: user.email,
          url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await email.sendVerificationEmail({
          to: user.email,
          url,
        });
      },
    },
    verification: {
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, endpointContext) => {
            if (!endpointContext) {
              throw sessionCreationError();
            }

            await requireActiveUserForSessionCreation(
              session.userId,
              (userId) =>
                endpointContext.context.internalAdapter.findUserById(userId),
            );
          },
        },
      },
    },
    user: {
      additionalFields: {
        globalRole: {
          type: ["USER", "ADMIN"],
          required: true,
          defaultValue: "USER",
          input: false,
          returned: true,
        },
        accountStatus: {
          type: ["ACTIVE", "SUSPENDED"],
          required: true,
          defaultValue: "ACTIVE",
          input: false,
          returned: true,
        },
      },
    },
  } satisfies BetterAuthOptions;

  return authOptions;
}
