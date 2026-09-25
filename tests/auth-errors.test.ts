import { describe, expect, it } from "vitest";

import { getAuthErrorMessage } from "@/features/auth/errors";

const GENERIC_MESSAGE =
  "We couldn't complete that request. Please try again in a moment.";

describe("auth client error mapping", () => {
  it("maps only known sign-in states to safe public copy", () => {
    expect(
      getAuthErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "sign-in"),
    ).toBe("The email or password is incorrect. Please try again.");
    expect(
      getAuthErrorMessage({ code: "EMAIL_NOT_VERIFIED" }, "sign-in"),
    ).toMatch(/verify your email/i);
    expect(
      getAuthErrorMessage({ code: "SESSION_CREATION_NOT_ALLOWED" }, "sign-in"),
    ).toBe("The email or password is incorrect. Please try again.");
  });

  it("maps expired and consumed reset states to one safe message", () => {
    const expected =
      "This password reset link is invalid, expired, or already used. Request a new one.";

    expect(
      getAuthErrorMessage({ code: "INVALID_TOKEN" }, "reset-password"),
    ).toBe(expected);
    expect(
      getAuthErrorMessage({ code: "TOKEN_EXPIRED" }, "reset-password"),
    ).toBe(expected);
  });

  it("maps rate limits without exposing response details", () => {
    expect(getAuthErrorMessage({ status: 429 }, "sign-in")).toMatch(
      /too many attempts/i,
    );
  });

  it("collapses provider, database, stack, and token details", () => {
    const unsafeError = {
      code: "UNKNOWN_PROVIDER_FAILURE",
      message: "PrismaClientUnknownRequestError at /srv/auth/reset",
      error: {
        cause: "postgresql://user:secret@localhost/teammate",
        stack: "Error: reset-token-value",
      },
    };

    expect(getAuthErrorMessage(unsafeError, "reset-password")).toBe(
      GENERIC_MESSAGE,
    );
    expect(getAuthErrorMessage(new Error("raw token"), "verification")).toBe(
      GENERIC_MESSAGE,
    );
  });
});
