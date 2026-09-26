// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE_URL = "https://app.teammate.example";
const SECRET = "a".repeat(64);
const API_KEY = "re_COMPOSITION_TESTSECRET_do_not_leak";
const FROM_ADDRESS = "no-reply@app.teammate.example";
const RECIPIENT = "person@example.com";
const URL = `${BASE_URL}/verify-email?token=compositionTOKEN&callbackURL=%2Fonboarding`;

const EMAIL_DIRECTORY = path.resolve(process.cwd(), "src", "server", "email");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(entryPath)
        : entry.isFile() && entry.name.endsWith(".ts")
          ? [entryPath]
          : [];
    }),
  );

  return nested.flat();
}

async function importAuthEmail(
  nodeEnv: string,
  extraEnv: Record<string, string | undefined> = {},
) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://teammate:teammate@localhost:5432/teammate",
  );
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_URL", BASE_URL);
  vi.stubEnv("RESEND_API_KEY", undefined);
  vi.stubEnv("AUTH_EMAIL_FROM_ADDRESS", undefined);
  for (const [key, value] of Object.entries(extraEnv)) {
    vi.stubEnv(key, value);
  }

  return (await import("@/server/email")) as typeof import("@/server/email");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("auth email composition", () => {
  it("keeps the bounded in-memory transport in development", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { authEmail } = await importAuthEmail("development");

    await expect(
      authEmail.sendVerificationEmail({ to: RECIPIENT, url: URL }),
    ).resolves.toBeUndefined();
    await expect(
      authEmail.sendPasswordResetEmail({ to: RECIPIENT, url: URL }),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("selects the Resend-backed adapter in production without any credential at import", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Importing the production boundary must not throw, must not read a secret,
    // and must not contact the provider: this is the CI `next build` contract.
    const { authEmail } = await importAuthEmail("production");

    expect(authEmail).toBeTypeOf("object");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed in production until the Resend credential is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { authEmail } = await importAuthEmail("production");

    const error = await authEmail
      .sendVerificationEmail({ to: RECIPIENT, url: URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    // Identity is asserted by name/reason: `vi.resetModules()` gives the freshly
    // imported boundary its own class instance.
    expect(error).toMatchObject({
      name: "AuthEmailDeliveryError",
      reason: "not-configured",
      message: "Auth email could not be delivered.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed in production on the dummy build-only HTTP auth URL", async () => {
    const { authEmail } = await importAuthEmail("production", {
      BETTER_AUTH_URL: "http://localhost:3000",
      RESEND_API_KEY: API_KEY,
      AUTH_EMAIL_FROM_ADDRESS: FROM_ADDRESS,
    });

    // The CI dummy value must never reach a provider, and the HTTP action URL
    // must be refused before any send.
    const error = await authEmail
      .sendVerificationEmail({
        to: RECIPIENT,
        url: `${BASE_URL}/verify-email?token=x`,
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toMatchObject({
      name: "AuthEmailDeliveryError",
      reason: "invalid-url",
      message: "Auth email could not be delivered.",
    });
  });
});

describe("provider SDK containment", () => {
  it("imports the Resend SDK from exactly one server-only module", async () => {
    const files = await sourceFiles(EMAIL_DIRECTORY);
    const importers: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/from "resend"/.test(source)) {
        importers.push(path.relative(EMAIL_DIRECTORY, file));
      }
    }

    expect(importers).toEqual(["resend.ts"]);
  });

  it("keeps the SDK binding server-only and outcome-only", async () => {
    const source = await readFile(
      path.join(EMAIL_DIRECTORY, "resend.ts"),
      "utf8",
    );

    expect(source).toMatch(/^import "server-only";/);
    // The SDK error result must be reduced at the boundary, never returned.
    expect(source).toMatch(/\{ delivered: false \}/);
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/throw new Error/);
  });

  it("keeps every other application module free of the provider SDK", async () => {
    const appDirectory = path.resolve(process.cwd(), "src");
    const files = (await sourceFiles(appDirectory)).filter(
      (file) => !file.startsWith(EMAIL_DIRECTORY),
    );

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(/from "resend"/);
    }
  });

  it("keeps the operational signal a single fixed argument-free message", async () => {
    const source = await readFile(
      path.join(EMAIL_DIRECTORY, "operational-log.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE =\s*"Verification email delivery failed\."/,
    );
    // Exactly one sink, one call, and the constant as its only argument.
    expect(source.match(/console\.\w+/g)).toEqual(["console.error"]);
    expect(
      source.match(
        /console\.error\(AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE\);/,
      ),
    ).not.toBeNull();
    // The emitter takes no parameters, so no value can ever be passed to it.
    expect(source).toContain(
      "export function reportVerificationDeliveryFailure(): void {",
    );
    expect(source.match(/export function \w+\(/g)).toEqual([
      "export function reportVerificationDeliveryFailure(",
    ]);
  });

  it("keeps production transport modules free of secrets and console output", async () => {
    for (const name of [
      "production.ts",
      "config.ts",
      "content.ts",
      "safety.ts",
    ]) {
      const source = await readFile(path.join(EMAIL_DIRECTORY, name), "utf8");
      expect(source, name).not.toMatch(/console\./);
      expect(source, name).not.toMatch(/RESEND_API_KEY\s*=\s*["']/);
    }
  });
});
