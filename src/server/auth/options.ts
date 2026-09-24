import type { BetterAuthOptions } from "better-auth";

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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
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
