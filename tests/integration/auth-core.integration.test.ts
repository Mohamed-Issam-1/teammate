import { createHash } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { APIError } from "better-auth/api";

import {
  getActiveSession,
  requireActiveVerifiedSession,
} from "../../src/server/auth/policy";
import {
  CapturedAuthEmail,
  resetTestDatabase,
  TEST_AUTH_BASE_URL,
  testAuth,
  testEmail,
  testPrisma,
  TestCookieJar,
} from "./fixtures";

const PASSWORD = "Correct-Horse-Battery-Staple-42";

let emailSequence = 0;

function nextEmail(prefix = "user"): string {
  emailSequence += 1;
  return `${prefix}-${emailSequence}@example.com`;
}

function onlyMessage(kind: CapturedAuthEmail["kind"]): CapturedAuthEmail {
  const messages = testEmail
    .takeAll()
    .filter((message) => message.kind === kind);
  expect(messages).toHaveLength(1);
  const message = messages[0];
  if (!message) {
    throw new Error("Expected a captured auth email");
  }
  return message;
}

function verificationToken(message: CapturedAuthEmail): string {
  const token = new URL(message.url).searchParams.get("token");
  if (!token) {
    throw new Error("Verification URL did not contain a token");
  }
  return token;
}

function resetToken(message: CapturedAuthEmail): string {
  const segments = new URL(message.url).pathname.split("/").filter(Boolean);
  const token = segments.at(-1);
  if (!token) {
    throw new Error("Reset URL did not contain a token");
  }
  return token;
}

async function expectApiError(
  promise: Promise<unknown>,
  expected: { code: string; message?: string; statusCode: number },
): Promise<APIError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(APIError);
  const apiError = error as APIError;
  expect(apiError.statusCode).toBe(expected.statusCode);
  expect(apiError.body).toMatchObject({ code: expected.code });
  if (expected.message) {
    expect(apiError.body).toMatchObject({ message: expected.message });
    expect(apiError.message).toBe(expected.message);
  }

  return apiError;
}

async function register(email = nextEmail(), password = PASSWORD) {
  const result = await testAuth.api.signUpEmail({
    body: {
      name: "Integration User",
      email,
      password,
    },
  });
  const message = onlyMessage("verification");

  return { email, password, result, verificationMessage: message };
}

async function registerVerified(email = nextEmail(), password = PASSWORD) {
  const registered = await register(email, password);
  await testAuth.api.verifyEmail({
    query: { token: verificationToken(registered.verificationMessage) },
  });

  return registered;
}

async function signIn(email: string, password = PASSWORD) {
  const result = await testAuth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookies = new TestCookieJar();
  cookies.capture(result.headers);

  return { cookies, session: result.response };
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("auth core registration and verification", () => {
  it("creates one user and one credential account without a session", async () => {
    const { email, result, verificationMessage } = await register();

    expect(result.token).toBeNull();
    expect(result.user.email).toBe(email);
    expect(result.user.emailVerified).toBe(false);
    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.account.count()).toBe(1);
    expect(await testPrisma.session.count()).toBe(0);

    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.globalRole).toBe("USER");
    expect(user.accountStatus).toBe("ACTIVE");
    expect(verificationMessage.kind).toBe("verification");
    expect(verificationMessage.to).toBe(email);
  });

  it("does not create a second user for an exact duplicate", async () => {
    const email = nextEmail();
    await register(email);
    const duplicate = await testAuth.api.signUpEmail({
      body: { name: "Duplicate", email, password: PASSWORD },
    });

    expect(duplicate.token).toBeNull();
    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.account.count()).toBe(1);
    expect(testEmail.takeAll()).toHaveLength(0);
  });

  it("keeps one complete user/account pair when duplicate registrations race", async () => {
    const email = nextEmail("race");
    const attempts = Array.from({ length: 2 }, (_, index) =>
      testAuth.api.signUpEmail({
        body: {
          name: `Race ${index}`,
          email,
          password: PASSWORD,
        },
      }),
    );

    const results = await Promise.allSettled(attempts);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(APIError);
        expect(result.reason).toMatchObject({ statusCode: 422 });
        expect((result.reason as APIError).body).toMatchObject({
          code: "FAILED_TO_CREATE_USER",
        });
        expect(JSON.stringify(result.reason)).not.toMatch(
          /prisma|postgres|constraint/i,
        );
      }
    }

    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.account.count()).toBe(1);
    expect(testEmail.takeAll()).toHaveLength(1);
  });

  it("treats case-variant emails as the same identity", async () => {
    const email = "Mixed.Case@Example.com";
    await register(email);
    const duplicate = await testAuth.api.signUpEmail({
      body: {
        name: "Duplicate",
        email: email.toLowerCase(),
        password: PASSWORD,
      },
    });

    expect(duplicate.token).toBeNull();
    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.account.count()).toBe(1);
    expect(testEmail.takeAll()).toHaveLength(0);
  });

  it.each([
    ["globalRole", "ADMIN"],
    ["accountStatus", "SUSPENDED"],
  ] as const)("ignores a malicious signup %s field", async (field, value) => {
    const email = nextEmail("malicious");
    const body = {
      name: "Malicious User",
      email,
      password: PASSWORD,
      [field]: value,
    };

    const result = await testAuth.api.signUpEmail({ body });
    expect(result.token).toBeNull();
    expect(await testPrisma.user.count()).toBe(1);
    expect(await testPrisma.account.count()).toBe(1);

    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.globalRole).toBe("USER");
    expect(user.accountStatus).toBe("ACTIVE");
    expect(testEmail.takeAll()).toHaveLength(1);
  });

  it("rejects sign-in before email verification without creating a session", async () => {
    const { email, password } = await register();

    await expectApiError(
      testAuth.api.signInEmail({ body: { email, password } }),
      { statusCode: 403, code: "EMAIL_NOT_VERIFIED" },
    );
    expect(await testPrisma.session.count()).toBe(0);
  });

  it("verifies an email and allows explicit sign-in, retrieval, and sign-out", async () => {
    const { email, password, verificationMessage } = await registerVerified();

    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(true);

    const { cookies, session } = await signIn(email, password);
    expect(session.token).toEqual(expect.any(String));
    expect(
      await testAuth.api.getSession({
        headers: cookies.headers(),
        query: { disableRefresh: true },
      }),
    ).not.toBeNull();

    await testAuth.api.signOut({ headers: cookies.headers() });

    expect(
      await testAuth.api.getSession({
        headers: cookies.headers(),
        query: { disableRefresh: true },
      }),
    ).toBeNull();
    expect(await testPrisma.session.count()).toBe(0);
    expect(verificationMessage.kind).toBe("verification");
  });

  it("rejects a tampered verification token safely", async () => {
    const { verificationMessage } = await register();
    const token = verificationToken(verificationMessage);
    const tampered = `${token.startsWith("a") ? "b" : "a"}${token.slice(1)}`;

    await expectApiError(
      testAuth.api.verifyEmail({ query: { token: tampered } }),
      { statusCode: 401, code: "INVALID_TOKEN" },
    );
  });

  it("rejects an expired verification token safely", async () => {
    const { verificationMessage } = await register();
    const token = verificationToken(verificationMessage);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      await expectApiError(testAuth.api.verifyEmail({ query: { token } }), {
        statusCode: 401,
        code: "TOKEN_EXPIRED",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auth core sign-in policy", () => {
  it("returns a generic failure for invalid credentials", async () => {
    const { email } = await registerVerified();

    const error = await expectApiError(
      testAuth.api.signInEmail({
        body: { email, password: "wrong-password" },
      }),
      {
        statusCode: 401,
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    );

    expect(JSON.stringify(error)).not.toMatch(/prisma|postgres|constraint/i);
  });

  it("prevents a suspended user from creating a new session without public state leakage", async () => {
    const { email, password } = await registerVerified();
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    await testPrisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "SUSPENDED" },
    });

    const error = await expectApiError(
      testAuth.api.signInEmail({ body: { email, password } }),
      {
        statusCode: 403,
        code: "SESSION_CREATION_NOT_ALLOWED",
        message: "Session could not be created.",
      },
    );
    expect(JSON.stringify(error)).not.toMatch(/suspend|accountStatus/i);
    expect(await testPrisma.session.count()).toBe(0);
  });

  it("blocks a known non-ACTIVE account status from creating a session", async () => {
    const { email, password } = await registerVerified();
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    await testPrisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "UNKNOWN" },
    });

    await expectApiError(
      testAuth.api.signInEmail({ body: { email, password } }),
      {
        statusCode: 403,
        code: "SESSION_CREATION_NOT_ALLOWED",
        message: "Session could not be created.",
      },
    );
    expect(await testPrisma.session.count()).toBe(0);
  });

  it("does not create a usable session for a nonexistent user", async () => {
    await expectApiError(
      testAuth.api.signInEmail({
        body: { email: "nonexistent@example.com", password: PASSWORD },
      }),
      { statusCode: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
    );
    expect(await testPrisma.session.count()).toBe(0);
  });

  it("rejects an existing session after the account becomes suspended", async () => {
    const { email, password } = await registerVerified();
    const { cookies } = await signIn(email, password);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });

    await testPrisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "SUSPENDED" },
    });

    const suspendedSession = await testAuth.api.getSession({
      headers: cookies.headers(),
      query: { disableRefresh: true },
    });
    expect(suspendedSession).not.toBeNull();
    expect(getActiveSession(suspendedSession)).toBeNull();
    expect(() => requireActiveVerifiedSession(suspendedSession)).toThrowError(
      "Authentication required",
    );
  });
});

describe("auth core privacy and password reset", () => {
  it("does not reveal whether forgot-password or verification-resend accounts exist", async () => {
    const { email } = await register();
    testEmail.clear();

    const existingReset = await testAuth.api.requestPasswordReset({
      body: { email },
    });
    const missingReset = await testAuth.api.requestPasswordReset({
      body: { email: "missing@example.com" },
    });
    expect(existingReset).toEqual(missingReset);
    expect(testEmail.takeAll()).toHaveLength(1);

    const existingResend = await testAuth.api.sendVerificationEmail({
      body: { email },
    });
    const missingResend = await testAuth.api.sendVerificationEmail({
      body: { email: "missing@example.com" },
    });
    expect(existingResend).toEqual(missingResend);
    expect(testEmail.takeAll()).toHaveLength(1);
  });

  it("stores password-reset identifiers using the approved hash", async () => {
    const { email } = await registerVerified();
    const response = await testAuth.api.requestPasswordReset({
      body: { email },
    });
    expect(response.status).toBe(true);
    const message = onlyMessage("password-reset");
    const token = resetToken(message);
    const expectedIdentifier = createHash("sha256")
      .update(`reset-password:${token}`)
      .digest("base64url");

    const stored = await testPrisma.verification.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.identifier).toBe(expectedIdentifier);
    expect(stored[0]?.identifier).not.toContain(token);
    expect(message.to).toBe(email);
  });

  it("rejects and consumes an expired reset token", async () => {
    const { email } = await registerVerified();
    await testAuth.api.requestPasswordReset({ body: { email } });
    const token = resetToken(onlyMessage("password-reset"));
    const identifier = createHash("sha256")
      .update(`reset-password:${token}`)
      .digest("base64url");

    await testPrisma.verification.updateMany({
      where: { identifier },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expectApiError(
      testAuth.api.resetPassword({
        body: { token, newPassword: "New-Password-123" },
      }),
      { statusCode: 400, code: "INVALID_TOKEN" },
    );
    expect(await testPrisma.verification.count()).toBe(0);
  });

  it("consumes a reset token once and changes the password", async () => {
    const { email, password } = await registerVerified();
    await testAuth.api.requestPasswordReset({ body: { email } });
    const token = resetToken(onlyMessage("password-reset"));
    const newPassword = "New-Password-456";

    await expect(
      testAuth.api.resetPassword({ body: { token, newPassword } }),
    ).resolves.toEqual({ status: true });
    await expectApiError(
      testAuth.api.resetPassword({ body: { token, newPassword } }),
      { statusCode: 400, code: "INVALID_TOKEN" },
    );

    await expectApiError(
      testAuth.api.signInEmail({ body: { email, password } }),
      {
        statusCode: 401,
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    );
    await expect(
      testAuth.api.signInEmail({ body: { email, password: newPassword } }),
    ).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("revokes existing sessions when a password reset succeeds", async () => {
    const { email, password } = await registerVerified();
    const { cookies } = await signIn(email, password);
    expect(await testPrisma.session.count()).toBe(1);

    await testAuth.api.requestPasswordReset({ body: { email } });
    const token = resetToken(onlyMessage("password-reset"));
    await testAuth.api.resetPassword({
      body: { token, newPassword: "Reset-Password-789" },
    });

    expect(await testPrisma.session.count()).toBe(0);
    expect(
      await testAuth.api.getSession({
        headers: cookies.headers(),
        query: { disableRefresh: true },
      }),
    ).toBeNull();
  });
});

describe("database-backed rate limiting", () => {
  it("returns 429 and records the limiter state after the built-in sign-in limit", async () => {
    const request = () =>
      testAuth.handler(
        new Request(new URL("/api/auth/sign-in/email", TEST_AUTH_BASE_URL), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: TEST_AUTH_BASE_URL,
          },
          body: JSON.stringify({
            email: "missing@example.com",
            password: "wrong-password",
          }),
        }),
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request();
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "INVALID_EMAIL_OR_PASSWORD",
      });
    }

    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-retry-after")).toMatch(/^\d+$/);
    expect(await limited.json()).toEqual({
      message: "Too many requests. Please try again later.",
    });
    expect(await testPrisma.rateLimit.count()).toBeGreaterThan(0);
  });
});
