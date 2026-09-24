import { describe, expect, it } from "vitest";

import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
  getActiveSession,
  requireActiveVerifiedSession,
} from "@/server/auth/policy";

const activeSession = {
  id: "session-id",
  user: {
    id: "user-id",
    accountStatus: "ACTIVE",
    emailVerified: true,
  },
};

describe("auth policy", () => {
  it("returns an active session", () => {
    expect(getActiveSession(activeSession)).toBe(activeSession);
    expect(requireActiveVerifiedSession(activeSession)).toBe(activeSession);
  });

  it("rejects a suspended session", () => {
    const suspendedSession = {
      ...activeSession,
      user: { ...activeSession.user, accountStatus: "SUSPENDED" },
    };

    expect(getActiveSession(suspendedSession)).toBeNull();
    expect(() => requireActiveVerifiedSession(suspendedSession)).toThrowError(
      AuthenticationRequiredError,
    );
  });

  it("requires a verified email for protected access", () => {
    const unverifiedSession = {
      ...activeSession,
      user: { ...activeSession.user, emailVerified: false },
    };

    expect(getActiveSession(unverifiedSession)).toBe(unverifiedSession);
    expect(() => requireActiveVerifiedSession(unverifiedSession)).toThrowError(
      EmailVerificationRequiredError,
    );
  });
});
