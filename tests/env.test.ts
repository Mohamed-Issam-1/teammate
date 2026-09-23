import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/env";

const DB_URL = "postgresql://teammate:teammate@localhost:5432/teammate";

function messageFrom(raw: Record<string, string | undefined>): string {
  try {
    parseEnv(raw);
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
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBeUndefined();
  });

  it("does not require auth or provider variables until their phase", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: DB_URL,
        BETTER_AUTH_SECRET: "",
        BETTER_AUTH_URL: "",
        REDIS_URL: "",
        RESEND_API_KEY: "",
        S3_SECRET_ACCESS_KEY: "",
        OPENAI_API_KEY: "",
        SENTRY_DSN: "",
      }),
    ).not.toThrow();
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("treats an empty DATABASE_URL as missing", () => {
    expect(() => parseEnv({ DATABASE_URL: "" })).toThrowError(/DATABASE_URL/);
  });

  it("rejects a non-PostgreSQL DATABASE_URL without echoing the value", () => {
    const secretish = "mysql://root:S3cr3tValue@localhost/teammate";

    const message = messageFrom({ DATABASE_URL: secretish });

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
    const message = messageFrom({
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
    const message = messageFrom({
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
