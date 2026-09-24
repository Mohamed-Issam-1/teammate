import { describe, expect, it } from "vitest";

import { createAuthOptions } from "@/server/auth/options";

const noopEmailOperation = async (): Promise<void> => {};

function options() {
  return createAuthOptions({
    baseURL: "http://localhost:3000",
    email: {
      sendVerificationEmail: noopEmailOperation,
      sendPasswordResetEmail: noopEmailOperation,
    },
  });
}

describe("createAuthOptions", () => {
  it("uses one exact local trusted origin without proxy-topology overrides", () => {
    const authOptions = options();

    expect(authOptions.baseURL).toBe("http://localhost:3000");
    expect(authOptions.trustedOrigins).toEqual(["http://localhost:3000"]);
    expect(authOptions).not.toHaveProperty("advanced");
  });

  it("enforces the approved email verification and password policy", () => {
    const authOptions = options();

    expect(authOptions.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
    });
    expect(authOptions.emailVerification).toMatchObject({
      sendOnSignUp: true,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
    });
  });

  it("uses database storage for the built-in rate limiter", () => {
    expect(options().rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
    });
  });

  it("keeps sessions database-backed and disables the cookie cache", () => {
    expect(options().session?.cookieCache?.enabled).toBe(false);
  });

  it("keeps identity fields server-owned and does not enable admin plugin", () => {
    const authOptions = options();

    expect(authOptions.user?.additionalFields?.globalRole).toMatchObject({
      type: ["USER", "ADMIN"],
      required: true,
      input: false,
      returned: true,
      defaultValue: "USER",
    });
    expect(authOptions.user?.additionalFields?.accountStatus).toMatchObject({
      type: ["ACTIVE", "SUSPENDED"],
      required: true,
      input: false,
      returned: true,
      defaultValue: "ACTIVE",
    });
    expect(authOptions).not.toHaveProperty("plugins");
  });
});
