import { describe, expect, it } from "vitest";

import { parseAuthEnv, parseEnv } from "@/lib/env";

const DB_URL = "postgresql://teammate:teammate@localhost:5432/teammate";
const AUTH_SECRET = "a".repeat(32);
const AUTH_URL = "http://localhost:3000";

function messageFrom(
  parser: (raw: Record<string, string | undefined>) => unknown,
  raw: Record<string, string | undefined>,
): string {
  try {
    parser(raw);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("parseEnv", () => {
  it("accepts the Phase 0 minimal environment (DATABASE_URL only)", () => {
    const env = parseEnv({ DATABASE_URL: DB_URL });

    expect(env.DATABASE_URL).toBe(DB_URL);
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.NEXT_PUBLIC_APP_URL).toBeUndefined();
    expect(env).not.toHaveProperty("BETTER_AUTH_SECRET");
    expect(env).not.toHaveProperty("BETTER_AUTH_URL");
  });

  it("does not require or retain auth or provider variables for db:check", () => {
    const env = parseEnv({
      DATABASE_URL: DB_URL,
      BETTER_AUTH_SECRET: "not-part-of-the-database-contract",
      BETTER_AUTH_URL: "http://localhost:3000",
      REDIS_URL: "redis://localhost:6379",
      RESEND_API_KEY: "not-part-of-the-database-contract",
      S3_SECRET_ACCESS_KEY: "not-part-of-the-database-contract",
      OPENAI_API_KEY: "not-part-of-the-database-contract",
      SENTRY_DSN: "not-part-of-the-database-contract",
    });

    expect(env).toEqual({ DATABASE_URL: DB_URL });
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("treats an empty DATABASE_URL as missing", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrowError(/DATABASE_URL/);
  });

  it("rejects a non-PostgreSQL DATABASE_URL without echoing the value", () => {
    const secretish = "mysql://root:S3cr3tValue@localhost/teammate";

    const message = messageFrom(parseEnv, { DATABASE_URL: secretish });

    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("S3cr3tValue");
  });

  it("validates NODE_ENV only when present", () => {
    expect(parseEnv({ DATABASE_URL: DB_URL, NODE_ENV: "test" }).NODE_ENV).toBe(
      "test",
    );
    expect(() =>
      parseEnv({ DATABASE_URL: DB_URL, NODE_ENV: "staging" }),
    ).toThrowError(/NODE_ENV/);
  });

  it("keeps invalid NODE_ENV values out of error messages", () => {
    const message = messageFrom(parseEnv, {
      DATABASE_URL: DB_URL,
      NODE_ENV: "staging-internal",
    });

    expect(message).toContain("NODE_ENV");
    expect(message).not.toContain("staging-internal");
  });

  it("keeps NEXT_PUBLIC_APP_URL optional", () => {
    expect(() => parseEnv({ DATABASE_URL: DB_URL })).not.toThrow();

    expect(
      parseEnv({
        DATABASE_URL: DB_URL,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }).NEXT_PUBLIC_APP_URL,
    ).toBe("http://localhost:3000");
  });

  it("rejects a present-but-invalid NEXT_PUBLIC_APP_URL without its value", () => {
    const message = messageFrom(parseEnv, {
      DATABASE_URL: DB_URL,
      NEXT_PUBLIC_APP_URL: "not-a-url-S3cr3t",
    });

    expect(message).toContain("NEXT_PUBLIC_APP_URL");
    expect(message).not.toContain("not-a-url-S3cr3t");
  });

  it("drops variables that are not part of the declared schema", () => {
    const env = parseEnv({
      DATABASE_URL: DB_URL,
      UNLISTED_SECRET: "hunter2",
    });

    expect(env).not.toHaveProperty("UNLISTED_SECRET");
  });
});

describe("parseAuthEnv", () => {
  it("accepts the local Better Auth foundation environment", () => {
    const env = parseAuthEnv({
      DATABASE_URL: DB_URL,
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: AUTH_URL,
    });

    expect(env.BETTER_AUTH_SECRET).toBe(AUTH_SECRET);
    expect(env.BETTER_AUTH_URL).toBe(AUTH_URL);
  });

  it("requires the auth secret and URL without making db:check stricter", () => {
    expect(() => parseAuthEnv({ DATABASE_URL: DB_URL })).toThrowError(
      /BETTER_AUTH_SECRET.*BETTER_AUTH_URL/,
    );
  });

  it("rejects short and placeholder secrets without echoing them", () => {
    const shortMessage = messageFrom(parseAuthEnv, {
      DATABASE_URL: DB_URL,
      BETTER_AUTH_SECRET: "too-short",
      BETTER_AUTH_URL: AUTH_URL,
    });
    const placeholderMessage = messageFrom(parseAuthEnv, {
      DATABASE_URL: DB_URL,
      BETTER_AUTH_SECRET: "replace-with-a-long-random-secret",
      BETTER_AUTH_URL: AUTH_URL,
    });

    expect(shortMessage).toContain("BETTER_AUTH_SECRET");
    expect(shortMessage).not.toContain("too-short");
    expect(placeholderMessage).toContain("BETTER_AUTH_SECRET");
    expect(placeholderMessage).not.toContain(
      "replace-with-a-long-random-secret",
    );
  });

  it("rejects a non-http auth URL without echoing it", () => {
    const message = messageFrom(parseAuthEnv, {
      DATABASE_URL: DB_URL,
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: "file://not-allowed",
    });

    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).not.toContain("file://not-allowed");
  });
});
