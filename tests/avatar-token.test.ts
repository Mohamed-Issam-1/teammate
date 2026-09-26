import { describe, expect, it } from "vitest";

import {
  AVATAR_CONTENT_TYPE,
  AVATAR_ROUTE_PREFIX,
  AVATAR_STORAGE_PREFIX,
  avatarObjectKeyForToken,
  avatarObjectKeyFromUrl,
  avatarUrlForToken,
  generateAvatarToken,
  isValidAvatarToken,
  parseAvatarTokenFromUrl,
} from "@/server/avatars/token";

/**
 * The opaque token and `Profile.avatarUrl` contract.
 *
 * Two properties matter. A generated token must be opaque and unguessable, and the
 * parser that recovers a token from a stored URL must accept *only* the exact
 * TeamMate-owned shape. That parser is the gate in front of every storage
 * deletion, so anything it lets through becomes a filesystem or bucket key.
 */

const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("token generation", () => {
  it("produces a valid opaque token", () => {
    const token = generateAvatarToken();

    expect(isValidAvatarToken(token)).toBe(true);
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("produces a distinct token each time", () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateAvatarToken()),
    );

    expect(tokens.size).toBe(500);
  });

  it("reveals nothing about an account", () => {
    const token = generateAvatarToken();

    // A token must not be derivable from, or contain, an identifier, an address,
    // or a name fragment.
    for (const forbidden of ["user", "avatar", "@", "profile"]) {
      expect(token, forbidden).not.toContain(forbidden);
    }
  });
});

describe("token validation", () => {
  it.each([
    ["an empty string", ""],
    ["a slug", "not-a-uuid"],
    ["a truncated uuid", "3f2504e0-4f89-41d3"],
    ["an uppercase uuid", "3F2504E0-4F89-41D3-9A0C-0305E82C3301"],
    ["a uuid with braces", "{3f2504e0-4f89-41d3-9a0c-0305e82c3301}"],
    ["a path segment", "avatars/3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["a traversal attempt", "../../etc/passwd"],
    ["a dot", "."],
    ["a null-ish value", "null"],
    ["a number as text", "12345"],
  ])("rejects %s", (_label, value) => {
    expect(isValidAvatarToken(value)).toBe(false);
  });
});

describe("avatarUrl construction", () => {
  it("builds a same-origin path under the avatar route", () => {
    expect(avatarUrlForToken(TOKEN)).toBe(`${AVATAR_ROUTE_PREFIX}${TOKEN}`);
  });

  it("never produces an absolute or protocol URL", () => {
    const url = avatarUrlForToken(generateAvatarToken());

    expect(url.startsWith("/")).toBe(true);
    expect(url).not.toContain("://");
    expect(url.startsWith("//")).toBe(false);
    expect(url).not.toMatch(/^data:/);
    expect(url).not.toMatch(/^javascript:/);
  });

  it("refuses to build a URL from an invalid token", () => {
    expect(() => avatarUrlForToken("nope")).toThrow();
    expect(() => avatarUrlForToken("")).toThrow();
    expect(() => avatarUrlForToken("a".repeat(40))).toThrow();
  });

  it("stores WebP content type", () => {
    expect(AVATAR_CONTENT_TYPE).toBe("image/webp");
  });
});

describe("storage object key", () => {
  it("uses a fixed namespace and the token, never a filename", () => {
    const key = avatarObjectKeyForToken(TOKEN);

    expect(key).toBe(`${AVATAR_STORAGE_PREFIX}${TOKEN}.webp`);
    expect(key).not.toContain("..");
    expect(key).not.toContain("\\");
  });

  it("refuses to build a key from an invalid token", () => {
    expect(() => avatarObjectKeyForToken("../escape")).toThrow();
    expect(() => avatarObjectKeyForToken("")).toThrow();
  });
});

describe("parsing a stored avatarUrl", () => {
  it("accepts the exact TeamMate avatar route", () => {
    expect(parseAvatarTokenFromUrl(`/avatars/${TOKEN}`)).toBe(TOKEN);
  });

  it("accepts a freshly generated URL", () => {
    const token = generateAvatarToken();

    expect(parseAvatarTokenFromUrl(avatarUrlForToken(token))).toBe(token);
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["an absolute https URL", "https://cdn.example.com/avatars/abc.png"],
    ["an http URL", "http://example.com/x.png"],
    ["a protocol-relative URL", "//example.com/x.png"],
    ["a data URL", "data:image/png;base64,iVBORw0KGgo="],
    ["a javascript URL", "javascript:alert(1)"],
    ["a bare token", TOKEN],
    ["a wrong prefix", `/profile/${TOKEN}`],
    ["a nested path", `/avatars/nested/${TOKEN}`],
    ["a trailing slash", `/avatars/${TOKEN}/`],
    ["a traversal segment", `/avatars/../${TOKEN}`],
    ["an encoded traversal", `/avatars/%2e%2e%2f${TOKEN}`],
    ["a query string", `/avatars/${TOKEN}?x=1`],
    ["a fragment", `/avatars/${TOKEN}#frag`],
    ["a doubled prefix", `/avatars//avatars/${TOKEN}`],
    ["a case-mismatched prefix", `/Avatars/${TOKEN}`],
    ["a path with a null byte", `/avatars/${TOKEN}%00.png`],
    ["a raw storage URL", "s3://bucket/avatars/x.webp"],
  ])("rejects %s", (_label, value) => {
    expect(parseAvatarTokenFromUrl(value)).toBeNull();
  });

  it("does not accept a value that merely contains an avatar path", () => {
    expect(
      parseAvatarTokenFromUrl(`https://evil.example/avatars/${TOKEN}`),
    ).toBeNull();
    expect(parseAvatarTokenFromUrl(`prefix/avatars/${TOKEN}`)).toBeNull();
    expect(parseAvatarTokenFromUrl(`/avatars/${TOKEN}suffix`)).toBeNull();
  });
});

describe("deriving a deletion key from a stored value", () => {
  it("produces a key for an exact TeamMate URL", () => {
    expect(avatarObjectKeyFromUrl(`/avatars/${TOKEN}`)).toBe(
      `${AVATAR_STORAGE_PREFIX}${TOKEN}.webp`,
    );
  });

  it("returns null for anything unrecognized, so nothing is deleted", () => {
    // This is the fail-safe that stops a legacy or externally-set avatarUrl from
    // being translated into an arbitrary object deletion.
    for (const value of [
      null,
      "",
      "https://cdn.example.com/avatar.png",
      "data:image/png;base64,AAAA",
      "s3://bucket/whatever",
      "/uploads/legacy.png",
      "/avatars/../../etc/passwd",
      `/avatars/${TOKEN}?evil=1`,
    ]) {
      expect(avatarObjectKeyFromUrl(value), String(value)).toBeNull();
    }
  });
});
