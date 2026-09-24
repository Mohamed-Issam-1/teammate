// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthEndpoint } from "@better-auth/core/api";
import { APIError, betterAuth, type BetterAuthPlugin } from "better-auth";

import { safeAuthLogger } from "@/server/auth/logger";

type UnsafeLoggerCall = (
  level: "debug" | "error" | "info" | "warn",
  message: string,
  ...args: unknown[]
) => void;

const SENSITIVE_FRAMEWORK_ERROR =
  "Prisma postgresql://teammate:secret@localhost/db reset-token=reset-secret cookie=session-secret";

const throwingPlugin: BetterAuthPlugin = {
  id: "safe-logger-test",
  endpoints: {
    throwSensitiveError: createAuthEndpoint(
      "/throw-sensitive-error",
      { method: "GET" },
      async () => {
        throw APIError.from("INTERNAL_SERVER_ERROR", {
          code: "TEST_SENSITIVE_ERROR",
          message: SENSITIVE_FRAMEWORK_ERROR,
        });
      },
    ),
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeAuthLogger", () => {
  it("publishes only fixed warning and error messages", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const log = safeAuthLogger.log as UnsafeLoggerCall;
    const rawDatabaseError = Object.assign(
      new Error("Prisma failure at postgresql://teammate:secret@localhost/db"),
      {
        code: "P1001",
        providerResponseBody: "access_token=provider-secret",
      },
    );

    log(
      "error",
      "password=plain-text reset-token=verification-secret",
      rawDatabaseError,
    );
    log("warn", "cookie=session-secret url=https://example.test/reset/token", {
      token: "reset-secret",
    });
    log("info", "provider response", { body: "provider-secret" });
    log("debug", "authorization bearer secret");

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Better Auth could not complete an operation.",
    );
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Better Auth rejected an operation.",
    );
    expect(consoleLog).not.toHaveBeenCalled();

    const emittedLogs = JSON.stringify([
      ...consoleError.mock.calls,
      ...consoleWarn.mock.calls,
      ...consoleLog.mock.calls,
    ]);
    expect(emittedLogs).not.toMatch(
      /password|token|cookie|secret|prisma|provider|postgresql/i,
    );
  });

  it("does not expose a raw APIError through Better Auth's handler path", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      logger: safeAuthLogger,
      plugins: [throwingPlugin],
      secret: "a".repeat(64),
    });

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/throw-sensitive-error"),
    );

    expect(response.status).toBe(500);
    expect(safeAuthLogger.level).toBe("info");
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();

    const emittedLogs = JSON.stringify([
      ...consoleError.mock.calls,
      ...consoleWarn.mock.calls,
      ...consoleLog.mock.calls,
    ]);
    expect(emittedLogs).not.toContain(SENSITIVE_FRAMEWORK_ERROR);
    expect(emittedLogs).not.toMatch(/prisma|postgresql|token|cookie|secret/i);
  });
});
