// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertSameOriginMutation,
  CrossOriginRequestError,
  isMultipartFormData,
  trustedApplicationOrigin,
} from "@/server/avatars/origin";

/**
 * Same-origin enforcement for the cookie-authenticated avatar endpoint.
 *
 * The upload route is a plain POST, so it does not receive the framework-level
 * Origin check a Server Action would. The comparison is against the
 * server-configured origin only, and a missing Origin is refused rather than
 * assumed safe.
 */

const envBackup = { ...process.env };

function post(origin: string | null): Request {
  return new Request("http://localhost/api/profile/avatar", {
    method: "POST",
    headers: origin === null ? {} : { origin },
  });
}

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://app.teammate.example";
});

afterEach(() => {
  process.env = { ...envBackup };
});

describe("trustedApplicationOrigin", () => {
  it("resolves the origin from the configured base URL", () => {
    expect(trustedApplicationOrigin()).toBe("https://app.teammate.example");
  });

  it("keeps only the origin, discarding path and port noise", () => {
    process.env.BETTER_AUTH_URL = "https://app.teammate.example/some/path?x=1";

    expect(trustedApplicationOrigin()).toBe("https://app.teammate.example");
  });

  it("preserves an explicit port", () => {
    process.env.BETTER_AUTH_URL = "http://localhost:3100";

    expect(trustedApplicationOrigin()).toBe("http://localhost:3100");
  });

  it("returns null when unconfigured or unparseable", () => {
    delete process.env.BETTER_AUTH_URL;
    expect(trustedApplicationOrigin()).toBeNull();

    process.env.BETTER_AUTH_URL = "not a url";
    expect(trustedApplicationOrigin()).toBeNull();
  });
});

describe("assertSameOriginMutation", () => {
  it("accepts the configured origin", () => {
    expect(() =>
      assertSameOriginMutation(post("https://app.teammate.example")),
    ).not.toThrow();
  });

  it("refuses a different same-scheme origin", () => {
    expect(() =>
      assertSameOriginMutation(post("https://evil.example")),
    ).toThrow(CrossOriginRequestError);
  });

  it("refuses a subdomain of the trusted origin", () => {
    expect(() =>
      assertSameOriginMutation(post("https://app.teammate.example.evil.test")),
    ).toThrow(CrossOriginRequestError);
  });

  it("refuses a prefixed origin, so a substring cannot satisfy the check", () => {
    expect(() =>
      assertSameOriginMutation(post("https://app.teammate.example.evil.test")),
    ).toThrow(CrossOriginRequestError);
  });

  it("refuses a scheme downgrade", () => {
    expect(() =>
      assertSameOriginMutation(post("http://app.teammate.example")),
    ).toThrow(CrossOriginRequestError);
  });

  it("refuses a missing Origin rather than assuming same-origin", () => {
    expect(() => assertSameOriginMutation(post(null))).toThrow(
      CrossOriginRequestError,
    );
  });

  it("refuses the literal string null", () => {
    expect(() => assertSameOriginMutation(post("null"))).toThrow(
      CrossOriginRequestError,
    );
  });

  it("refuses when the application origin is not configured", () => {
    delete process.env.BETTER_AUTH_URL;

    expect(() =>
      assertSameOriginMutation(post("https://app.teammate.example")),
    ).toThrow(CrossOriginRequestError);
  });

  it("never leaks the trusted origin in its error", () => {
    try {
      assertSameOriginMutation(post("https://evil.example"));
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(CrossOriginRequestError);
      expect((error as Error).message).not.toContain("teammate.example");
      expect((error as Error).message).not.toContain("evil.example");
    }
  });
});

describe("isMultipartFormData", () => {
  it.each([
    ["multipart/form-data", true],
    ["multipart/form-data; boundary=abc123", true],
    ["MULTIPART/FORM-DATA", true],
    ["  multipart/form-data  ", true],
    ["application/json", false],
    ["application/x-www-form-urlencoded", false],
    ["image/png", false],
  ])("classifies %s as %s", (value, expected) => {
    expect(isMultipartFormData(value)).toBe(expected);
  });

  it("treats a null content type as not multipart", () => {
    expect(isMultipartFormData(null)).toBe(false);
  });
});
