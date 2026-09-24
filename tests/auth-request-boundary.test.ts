// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthEndpoint } from "@better-auth/core/api";
import { APIError, betterAuth, type BetterAuthPlugin } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";

import { createGuardedAuthHandler } from "@/server/auth/http-handler";
import { createAuthOptions } from "@/server/auth/options";

const TEST_BASE_URL = "http://localhost:3000";
const FAKE_MARKERS = [
  "FAKE_PRISMA_SECRET_7f43",
  "FAKE_DATABASE_SECRET",
  "FAKE_PROVIDER_RESPONSE_SECRET",
] as const;

let injectedError: Error | undefined;

const noopEmailOperation = async (): Promise<void> => {};

const faultInjectionPlugin: BetterAuthPlugin = {
  id: "auth-request-boundary-test",
  endpoints: {
    failWithRawError: createAuthEndpoint(
      "/fault-injection/raw-error",
      { method: "GET" },
      async () => {
        const error = new Error(
          `Unexpected framework failure: ${FAKE_MARKERS[0]}`,
        );
        error.name = "PrismaClientUnknownRequestError";
        error.cause = {
          connectionString: `postgresql://teammate:${FAKE_MARKERS[1]}@localhost/db`,
          providerResponseBody: FAKE_MARKERS[2],
        };
        injectedError = error;
        throw error;
      },
    ),
    expectedApiError: createAuthEndpoint(
      "/fault-injection/expected-api-error",
      { method: "GET" },
      async () => {
        throw APIError.from("BAD_REQUEST", {
          code: "EXPECTED_AUTH_ERROR",
          message: "Expected safe authentication error.",
        });
      },
    ),
  },
};

function createTestHandler() {
  const auth = betterAuth({
    ...createAuthOptions({
      baseURL: TEST_BASE_URL,
      email: {
        sendVerificationEmail: noopEmailOperation,
        sendPasswordResetEmail: noopEmailOperation,
      },
    }),
    plugins: [faultInjectionPlugin],
    secret: "a".repeat(64),
  });

  return toNextJsHandler(createGuardedAuthHandler(auth.handler));
}

function captureConsole() {
  return {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  injectedError = undefined;
});

describe("guarded Better Auth request boundary", () => {
  it("turns an escaped non-APIError into a generic 500 without raw logging", async () => {
    const console = captureConsole();
    const handlers = createTestHandler();

    const response = await handlers.GET(
      new Request(`${TEST_BASE_URL}/api/auth/fault-injection/raw-error`),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(injectedError).toBeInstanceOf(Error);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Better Auth could not complete an operation.",
    );
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();

    const loggedArguments = [
      ...console.error.mock.calls,
      ...console.warn.mock.calls,
      ...console.log.mock.calls,
    ].flat();
    expect(loggedArguments).not.toContain(injectedError);
    expect(
      loggedArguments.every((argument) => typeof argument === "string"),
    ).toBe(true);

    for (const argument of loggedArguments) {
      if (typeof argument !== "string") {
        continue;
      }
      expect(argument).not.toContain("# SERVER_ERROR:");
      for (const marker of FAKE_MARKERS) {
        expect(argument).not.toContain(marker);
      }
    }
  });

  it("preserves an expected safe APIError response", async () => {
    const console = captureConsole();
    const handlers = createTestHandler();

    const response = await handlers.GET(
      new Request(
        `${TEST_BASE_URL}/api/auth/fault-injection/expected-api-error`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "EXPECTED_AUTH_ERROR",
      message: "Expected safe authentication error.",
    });
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});
