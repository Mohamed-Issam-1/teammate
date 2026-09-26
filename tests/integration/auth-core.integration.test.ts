import { createHash } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { APIError } from "better-auth/api";
import { toNextJsHandler } from "better-auth/next-js";

import { createAuth } from "../../src/server/auth/factory";
import { createGuardedAuthHandler } from "../../src/server/auth/http-handler";
import { createProductionAuthEmailConfigSource } from "../../src/server/email/config";
import { AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE } from "../../src/server/email/operational-log";
import { ResendProductionEmailTransport } from "../../src/server/email/production";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
  getActiveSession,
  requireActiveVerifiedSession,
} from "../../src/server/auth/policy";
import {
  completeOnboardingForSession,
  getOnboardingStateForSession,
  InvalidOnboardingInputError,
} from "../../src/server/profiles/onboarding";
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
const PROVIDER_FAILURE_MARKER =
  "Provider failure: postgresql://teammate:secret@localhost/db reset-token=secret";
const PROVIDER_RESPONSE_BODY_MARKER = "PROVIDER_RESPONSE_BODY_do_not_leak";

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

const PRODUCTION_BASE_URL = "https://app.teammate.example";
const TEST_RESEND_API_KEY = "re_INTEGRATION_TESTSECRET_do_not_log";
const TEST_FROM_ADDRESS = "no-reply@integration.example";

type ProviderBehaviour = "throws" | "rejects";

/**
 * The real production Resend transport, wired to a fake provider that fails the
 * way a genuine outage or a rejected send does. The fake deliberately carries
 * provider detail and an API key so the test can prove neither ever escapes.
 */
function createProductionEmailAuth(
  behaviour: ProviderBehaviour,
  baseUrl = PRODUCTION_BASE_URL,
) {
  return createAuth({
    baseURL: baseUrl,
    database: testPrisma,
    email: new ResendProductionEmailTransport({
      loadConfig: createProductionAuthEmailConfigSource({
        env: {
          RESEND_API_KEY: TEST_RESEND_API_KEY,
          AUTH_EMAIL_FROM_ADDRESS: TEST_FROM_ADDRESS,
        },
        baseUrl,
      }),
      createProvider: () => ({
        async send() {
          if (behaviour === "rejects") {
            return { delivered: false };
          }

          throw Object.assign(new Error(PROVIDER_FAILURE_MARKER), {
            responseBody: PROVIDER_RESPONSE_BODY_MARKER,
            apiKey: TEST_RESEND_API_KEY,
          });
        },
      }),
    }),
    secret: createHash("sha256")
      .update("teammate-auth-core-integration-test")
      .digest("hex"),
  });
}

type PostCapableHandler = {
  POST: (request: Request) => Promise<Response>;
};

/** Call the native Better Auth `send-verification-email` endpoint directly. */
function resendVerificationEmail(handler: PostCapableHandler, email: string) {
  return handler.POST(
    new Request(`${TEST_AUTH_BASE_URL}/api/auth/send-verification-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

/** Spy on every console sink so the emitted signal can be asserted exactly. */
function captureConsole() {
  const sinks = {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    info: vi.spyOn(console, "info").mockImplementation(() => undefined),
    debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
  };

  return {
    output: () =>
      Object.values(sinks)
        .flatMap((sink) => sink.mock.calls.flat())
        .map(String)
        .join("\n"),
    reset: () => {
      for (const sink of Object.values(sinks)) {
        sink.mockClear();
      }
    },
  };
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

async function sessionFor(email: string) {
  const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
  return { user };
}

async function authenticatedSessionFor(email: string, password: string) {
  const { cookies } = await signIn(email, password);
  const session = await testAuth.api.getSession({
    headers: cookies.headers(),
    query: { disableRefresh: true },
  });

  if (!session) {
    throw new Error("Expected an authenticated test session");
  }

  return session;
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

  it("keeps the forgot-password response neutral when delivery fails", async () => {
    const { email } = await register();
    const failingAuth = createProductionEmailAuth("throws");

    const existingReset = await failingAuth.api.requestPasswordReset({
      body: { email },
    });
    const missingReset = await failingAuth.api.requestPasswordReset({
      body: { email: "missing@example.com" },
    });

    // Better Auth 1.7.5 awaits reset delivery through `runInBackgroundOrAwait`,
    // which swallows a transport failure, so a delivery failure is
    // indistinguishable from account existence at the API boundary. The reset
    // callback itself is deliberately left unnormalized.
    expect(existingReset).toEqual(missingReset);
    expect(existingReset).toEqual(
      await testAuth.api.requestPasswordReset({
        body: { email: "missing@example.com" },
      }),
    );
  });

  it("cannot distinguish a failed verification delivery from a missing account", async () => {
    const { email } = await register();
    const captured = captureConsole();
    const handler = toNextJsHandler(
      createGuardedAuthHandler(createProductionEmailAuth("throws").handler),
    );

    // A: existing + unverified + provider failure.
    // B: nonexistent account, so no delivery is attempted at all.
    const failed = await resendVerificationEmail(handler, email);
    const missing = await resendVerificationEmail(
      handler,
      "missing@example.com",
    );

    expect(failed.status).toBe(200);
    expect(missing.status).toBe(200);
    const failedBody = await failed.text();
    expect(failedBody).toBe(await missing.text());
    expect(JSON.parse(failedBody)).toEqual({ status: true });

    // Only the single approved fixed operational line may be emitted, with no
    // provider detail, recipient, URL, token, or better-call raw sink.
    const logged = captured.output();
    expect(logged).toContain(AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE);
    expect(logged).not.toContain(PROVIDER_FAILURE_MARKER);
    expect(logged).not.toContain(PROVIDER_RESPONSE_BODY_MARKER);
    expect(logged).not.toContain(TEST_RESEND_API_KEY);
    expect(logged).not.toContain("postgresql://");
    expect(logged).not.toContain("reset-token");
    expect(logged).not.toContain(email);
    expect(logged).not.toContain("missing@example.com");
    expect(logged).not.toContain("verify-email?token=");
    expect(logged).not.toContain("# SERVER_ERROR:");

    // A successful delivery must still delegate and must not emit the line.
    captured.reset();
    const healthy = await resendVerificationEmail(
      toNextJsHandler(createGuardedAuthHandler(testAuth.handler)),
      email,
    );
    expect(healthy.status).toBe(200);
    expect(captured.output()).not.toContain(
      AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE,
    );
    expect(
      testEmail.takeAll().filter((message) => message.kind === "verification"),
    ).toHaveLength(1);
  });

  it("cannot distinguish a failed verification delivery from a verified account", async () => {
    const { email: verifiedEmail } = await registerVerified();
    captureConsole();
    const handler = toNextJsHandler(
      createGuardedAuthHandler(createProductionEmailAuth("rejects").handler),
    );

    // A: existing + unverified + provider rejecting the send.
    // C: existing + already verified, so no delivery is attempted.
    const unverified = await register();
    const failed = await resendVerificationEmail(handler, unverified.email);
    const verified = await resendVerificationEmail(handler, verifiedEmail);

    expect(failed.status).toBe(200);
    expect(verified.status).toBe(200);
    expect(await failed.text()).toBe(await verified.text());
  });

  it("normalizes a rejected production action URL on the resend endpoint", async () => {
    const { email } = await register();
    const captured = captureConsole();
    // The CI-shaped HTTP base URL cannot produce a valid production action link,
    // so the transport fails closed with `invalid-url` before any send. That
    // failure must be normalized exactly like a provider failure.
    const handler = toNextJsHandler(
      createGuardedAuthHandler(
        createProductionEmailAuth("throws", TEST_AUTH_BASE_URL).handler,
      ),
    );

    const failed = await resendVerificationEmail(handler, email);
    const missing = await resendVerificationEmail(
      handler,
      "missing@example.com",
    );

    expect(failed.status).toBe(200);
    expect(await failed.text()).toBe(await missing.text());
    expect(captured.output()).toContain(
      AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE,
    );
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

describe("Phase 1 onboarding invariants", () => {
  it("creates a profile from the authenticated identity and trims the display name", async () => {
    const { email, password } = await registerVerified(
      nextEmail("onboard-create"),
    );
    const session = await authenticatedSessionFor(email, password);
    const initialState = await getOnboardingStateForSession(
      session,
      testPrisma,
    );

    expect(initialState).toEqual({
      displayName: "Integration User",
      onboardingComplete: false,
      profileExists: false,
    });

    const result = await completeOnboardingForSession(
      session,
      { displayName: "  Ada Lovelace  " },
      testPrisma,
    );
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    const profile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(result).toMatchObject({
      displayName: "Ada Lovelace",
      onboardingComplete: true,
      completedNow: true,
    });
    expect(profile.userId).toBe(user.id);
    expect(profile.displayName).toBe("Ada Lovelace");
    expect(profile.onboardingCompletedAt).toBeInstanceOf(Date);
    await expect(
      getOnboardingStateForSession(session, testPrisma),
    ).resolves.toEqual({
      displayName: "Ada Lovelace",
      onboardingComplete: true,
      profileExists: true,
    });
  });

  it("updates an existing incomplete profile without changing its identity", async () => {
    const { email, password } = await registerVerified(
      nextEmail("onboard-existing"),
    );
    const session = await authenticatedSessionFor(email, password);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    await testPrisma.profile.create({
      data: {
        userId: user.id,
        displayName: "Existing Name",
        onboardingCompletedAt: null,
      },
    });
    await expect(
      getOnboardingStateForSession(session, testPrisma),
    ).resolves.toMatchObject({
      displayName: "Existing Name",
      onboardingComplete: false,
      profileExists: true,
    });

    const result = await completeOnboardingForSession(
      session,
      { displayName: "  Updated Name  " },
      testPrisma,
    );
    const profile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(result.completedNow).toBe(true);
    expect(profile).toMatchObject({
      userId: user.id,
      displayName: "Updated Name",
    });
    expect(profile.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("rejects unauthenticated, unverified, and suspended sessions without writes", async () => {
    await expect(
      completeOnboardingForSession(
        null,
        { displayName: "Should Not Exist" },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(AuthenticationRequiredError);

    const { email: unverifiedEmail } = await register(
      nextEmail("onboard-unverified"),
    );
    const unverifiedSession = await sessionFor(unverifiedEmail);
    await expect(
      completeOnboardingForSession(
        unverifiedSession,
        { displayName: "Should Not Exist" },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(EmailVerificationRequiredError);

    const { email: suspendedEmail } = await registerVerified(
      nextEmail("onboard-suspended"),
    );
    const suspendedUser = await testPrisma.user.findUniqueOrThrow({
      where: { email: suspendedEmail },
    });
    await testPrisma.user.update({
      where: { id: suspendedUser.id },
      data: { accountStatus: "SUSPENDED" },
    });
    await expect(
      completeOnboardingForSession(
        { user: { ...suspendedUser, accountStatus: "SUSPENDED" } },
        { displayName: "Should Not Exist" },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(AuthenticationRequiredError);

    expect(await testPrisma.profile.count()).toBe(0);
  });

  it("rejects malicious extra fields and never writes another user's profile", async () => {
    const { email: ownerEmail, password: ownerPassword } =
      await registerVerified(nextEmail("onboard-owner"));
    const { email: otherEmail, password: otherPassword } =
      await registerVerified(nextEmail("onboard-other"));
    const ownerSession = await authenticatedSessionFor(
      ownerEmail,
      ownerPassword,
    );
    const otherSession = await authenticatedSessionFor(
      otherEmail,
      otherPassword,
    );
    const otherUser = await testPrisma.user.findUniqueOrThrow({
      where: { email: otherEmail },
    });
    await testPrisma.profile.create({
      data: {
        userId: otherUser.id,
        displayName: "Other User",
        onboardingCompletedAt: null,
      },
    });

    await expect(
      completeOnboardingForSession(
        ownerSession,
        {
          displayName: "Owner Name",
          userId: otherUser.id,
          onboardingCompletedAt: new Date("2000-01-01T00:00:00.000Z"),
          globalRole: "ADMIN",
          accountStatus: "SUSPENDED",
        },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidOnboardingInputError);

    expect(
      await testPrisma.profile.findUnique({ where: { userId: otherUser.id } }),
    ).toMatchObject({
      userId: otherUser.id,
      displayName: "Other User",
      onboardingCompletedAt: null,
    });
    expect(
      await testPrisma.profile.findUnique({
        where: { userId: ownerSession.user.id },
      }),
    ).toBeNull();

    await completeOnboardingForSession(
      ownerSession,
      { displayName: "Owner Name" },
      testPrisma,
    );
    expect(
      await testPrisma.profile.findUnique({
        where: { userId: otherUser.id },
      }),
    ).toMatchObject({
      displayName: "Other User",
      onboardingCompletedAt: null,
    });
    await expect(
      getOnboardingStateForSession(otherSession, testPrisma),
    ).resolves.toMatchObject({
      displayName: "Other User",
      onboardingComplete: false,
    });
  });

  it("handles concurrent completion idempotently", async () => {
    const { email, password } = await registerVerified(
      nextEmail("onboard-concurrent"),
    );
    const session = await authenticatedSessionFor(email, password);
    const results = await Promise.all([
      completeOnboardingForSession(
        session,
        { displayName: "First Concurrent Name" },
        testPrisma,
      ),
      completeOnboardingForSession(
        session,
        { displayName: "Second Concurrent Name" },
        testPrisma,
      ),
    ]);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    const profiles = await testPrisma.profile.findMany({
      where: { userId: user.id },
    });

    expect(results.filter((result) => result.completedNow)).toHaveLength(1);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.userId).toBe(user.id);
    expect(profiles[0]?.displayName).toBe(
      results.find((result) => result.completedNow)?.displayName,
    );
    expect(
      results.every(
        (result) => result.displayName === profiles[0]?.displayName,
      ),
    ).toBe(true);
    expect(profiles[0]?.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("does not reset the completion timestamp or canonical name after completion", async () => {
    const { email, password } = await registerVerified(
      nextEmail("onboard-repeat"),
    );
    const session = await authenticatedSessionFor(email, password);
    await completeOnboardingForSession(
      session,
      { displayName: "Canonical Name" },
      testPrisma,
    );
    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    const firstProfile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const firstCompletion = firstProfile.onboardingCompletedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const repeated = await completeOnboardingForSession(
      session,
      { displayName: "Should Not Replace" },
      testPrisma,
    );
    const finalProfile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(repeated.completedNow).toBe(false);
    expect(finalProfile.displayName).toBe("Canonical Name");
    expect(finalProfile.onboardingCompletedAt).toEqual(firstCompletion);
  });
});
