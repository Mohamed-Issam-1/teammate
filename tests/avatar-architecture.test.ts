import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Architectural guards for the avatar feature.
 *
 * Several of this checkpoint's requirements are not observable from a behavioral
 * test: a storage adapter could quietly gain a listing method, a write could widen
 * beyond `avatarUrl`, or the filesystem test adapter could become reachable
 * outside a guarded run. These read the source so a later change cannot introduce
 * any of those silently.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function filesUnder(relativeDirectory: string): string[] {
  const root = path.join(repoRoot, relativeDirectory);
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(full)) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found;
}

const avatarServerFiles = filesUnder("src/server/avatars");

describe("avatar storage surface", () => {
  it("exposes only put, get, and delete", () => {
    const source = read("src/server/avatars/storage.ts");

    expect(source).toMatch(
      /export type AvatarStorage = \{[\s\S]*?put\([\s\S]*?get\([\s\S]*?delete\(/,
    );

    // No listing, search, or enumeration operation of any kind.
    for (const forbidden of [
      "list",
      "listObjects",
      "head",
      "copy",
      "move",
      "presign",
      "getSignedUrl",
    ]) {
      expect(source, forbidden).not.toMatch(
        new RegExp(`^\\s*${forbidden}\\??\\(`, "m"),
      );
    }
  });

  it("never reads a public bucket URL", () => {
    for (const file of avatarServerFiles) {
      const source = readFileSync(file, "utf8");
      // Naming the variable in a comment that says it must not be used is
      // documentation, not usage. What must not exist is a *read* of it.
      expect(source, file).not.toMatch(
        /(raw|env|process\.env)\s*[.[(]\s*["']S3_PUBLIC_BASE_URL/,
      );
      expect(source, file).not.toMatch(/["']S3_PUBLIC_BASE_URL["']\s*[:),]/);
    }
  });

  it("has no presigned URL support anywhere in the avatar code", () => {
    for (const file of avatarServerFiles) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "getSignedUrl",
        "createPresignedPost",
        "PutObjectPresigned",
        "@aws-sdk/s3-presigned-post",
        "@aws-sdk/s3-request-presigner",
      ]) {
        expect(source, `${forbidden} in ${file}`).not.toContain(forbidden);
      }
    }
  });
});

describe("own-avatar write boundary", () => {
  it("narrows the database contract to reads plus profile.updateMany", () => {
    const source = read("src/server/avatars/own-avatar.ts");

    // Formatting-independent: read the method names the contract allows, and
    // assert that no write beyond updateMany is reachable on either delegate.
    const profileMethods =
      /profile:\s*Pick<[^>]*\["profile"\],\s*([^>]+)>/.exec(source)?.[1] ?? "";
    const userMethods =
      /user:\s*Pick<[^>]*\["user"\],\s*([^>]+)>/.exec(source)?.[1] ?? "";

    const allowed = new Set([
      "findUnique",
      "findFirst",
      "findMany",
      "updateMany",
      "count",
    ]);
    const profileAllowed = profileMethods
      .split("|")
      .map((name) => name.trim().replace(/["']/g, ""))
      .filter(Boolean);
    const userAllowed = userMethods
      .split("|")
      .map((name) => name.trim().replace(/["']/g, ""))
      .filter(Boolean);

    expect(profileAllowed.length).toBeGreaterThan(0);
    expect(userAllowed.length).toBeGreaterThan(0);
    for (const name of [...profileAllowed, ...userAllowed]) {
      expect(allowed.has(name), `${name} should be a read or updateMany`).toBe(
        true,
      );
    }

    // The single-row write is the only mutation, and it is a conditional update.
    expect(profileAllowed).toContain("updateMany");
    // No single-row update or any delete is reachable.
    for (const forbidden of [
      "update",
      "upsert",
      "delete",
      "deleteMany",
      "create",
    ]) {
      expect(profileAllowed, forbidden).not.toContain(forbidden);
      expect(userAllowed, forbidden).not.toContain(forbidden);
    }
  });

  it("resolves an avatar token with a unique lookup, not a search", () => {
    const source = read("src/server/avatars/own-avatar.ts");

    expect(source).toMatch(/findUnique\(\{\s*where: \{ avatarUrl \}/);
    expect(source).not.toMatch(/findFirst/);
    expect(source).not.toMatch(/startsWith/);
    expect(source).not.toMatch(/\$queryRaw/);
  });

  it("writes only avatarUrl", () => {
    const source = read("src/server/avatars/own-avatar.ts");

    const write = source.slice(
      source.indexOf("async function writeOwnAvatarUrl"),
      source.indexOf("export async function saveOwnAvatar"),
    );

    expect(write).toMatch(/data: \{ avatarUrl \}/);
    // No spreading of caller input into the payload.
    expect(write).not.toMatch(/\.\.\./);
  });

  it("never writes User.image or any auth-owned field", () => {
    for (const file of avatarServerFiles) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "image:",
        "globalRole:",
        "accountStatus:",
        "emailVerified:",
        "email:",
      ]) {
        // A session *type* may declare these, but no write payload may.
        const asWrite =
          source.includes(`${forbidden} true`) ||
          source.includes(`data: { ${forbidden.replace(":", "")}`);
        expect(asWrite, `${forbidden} in ${file}`).toBe(false);
      }
    }
  });

  it("takes no user identifier, URL, or storage key from a caller", () => {
    const source = read("src/server/avatars/own-avatar.ts");

    for (const signature of [
      /export async function saveOwnAvatar\(\s*session: OwnAvatarSession \| null/,
      /export async function removeOwnAvatar\(\s*session: OwnAvatarSession \| null/,
    ]) {
      expect(source).toMatch(signature);
    }

    // The caller's bytes are the only request-shaped input.
    expect(source).not.toMatch(
      /export async function saveOwnAvatar\([^)]*userId/,
    );
    expect(source).not.toMatch(
      /export async function saveOwnAvatar\([^)]*avatarUrl/,
    );
    expect(source).not.toMatch(
      /export async function saveOwnAvatar\([^)]*objectKey/,
    );
  });
});

describe("filesystem adapter containment", () => {
  it("is selected only under the guarded end-to-end marker", () => {
    const source = read("src/server/avatars/current-avatar-storage.ts");

    expect(source).toContain("isEndToEndTestProcess");
    expect(source).toMatch(
      /E2E_DATABASE_CONTEXT_ENV\]\s*===\s*E2E_DATABASE_CONTEXT_VALUE/,
    );
    expect(source).toMatch(/NODE_ENV\s*!==\s*"production"/);
  });

  it("never falls back to the filesystem outside a test run", () => {
    const source = read("src/server/avatars/current-avatar-storage.ts");

    // Everything from the S3 assignment onward is the non-test path, so it must
    // never mention the filesystem adapter.
    const fallback = source.slice(
      source.indexOf("cached = createS3AvatarStorage"),
    );
    expect(fallback).toContain("createS3AvatarStorage");
    expect(fallback).not.toContain("createFilesystemAvatarStorage");

    // The filesystem adapter is constructed exactly once, as an assignment inside
    // the guarded branch. Matching the assignment rather than the bare name avoids
    // matching the import statement at the top of the file.
    const constructions =
      source.match(/=\s*createFilesystemAvatarStorage\(/g) ?? [];
    expect(constructions).toHaveLength(1);
    expect(source.indexOf("= createFilesystemAvatarStorage(")).toBeGreaterThan(
      source.indexOf("if (isEndToEndTestProcess())"),
    );
  });

  it("carries its own production refusal inside the adapter", () => {
    // Defence in depth, mirroring the guarded email transport: the adapter refuses
    // even if the selector were ever reordered.
    const source = read("src/server/avatars/filesystem-storage.ts");

    expect(source).toContain("AvatarStorageUnavailableError");
    expect(source).toMatch(/NODE_ENV\s*===\s*"production"/);
    expect(source).toMatch(/E2E_DATABASE_CONTEXT_VALUE/);
  });

  it("refuses any key outside the fixed namespace and verifies the resolved path", () => {
    const source = read("src/server/avatars/filesystem-storage.ts");

    expect(source).toContain("KEY_PATTERN");
    expect(source).toContain("path.resolve");
    expect(source).toContain("startsWith(base + path.sep)");
  });
});

describe("delivery route", () => {
  it("applies the shared visibility policy rather than its own rules", () => {
    const source = read("src/app/avatars/[token]/route.ts");

    expect(source).toContain("isProfileVisibleTo");
    expect(source).toContain("visibilityTargetSelect");

    // It must not re-implement eligibility or visibility locally.
    expect(source).not.toContain("profileVisibility ===");
    expect(source).not.toContain('accountStatus === "ACTIVE"');
  });

  it("sends no-store headers on both the success and not-found paths", () => {
    const source = read("src/app/avatars/[token]/route.ts");

    const notFoundOccurrences = source.split("private, no-store").length - 1;
    expect(notFoundOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("uses no shared cache primitive", () => {
    const source = read("src/app/avatars/[token]/route.ts");

    for (const forbidden of [
      "unstable_cache",
      "revalidateTag",
      "revalidatePath",
      '"use cache"',
      "cacheLife",
      "cacheTag",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("adds no avatar listing or search endpoint", () => {
    const files = filesUnder("src/app/avatars");

    expect(files).toHaveLength(1);
    expect(files[0]).toContain("route.ts");
  });
});

describe("upload endpoint", () => {
  it("requires same-origin and accepts multipart only", () => {
    const source = read("src/app/api/profile/avatar/route.ts");

    expect(source).toContain("assertSameOriginMutation");
    expect(source).toContain("isMultipartFormData");
  });

  it("accepts exactly one file field and refuses extras", () => {
    const source = read("src/app/api/profile/avatar/route.ts");

    expect(source).toMatch(/entries\.length !== 1/);
    expect(source).toMatch(/entries\[0\] !== FILE_FIELD/);
  });

  it("never returns raw library or provider error text", () => {
    const source = read("src/app/api/profile/avatar/route.ts");

    // The mapper is exhaustive over the known error types and has a generic tail.
    expect(source).toContain("describeUploadError");
    expect(source).toMatch(/INTERNAL_ERROR/);
    // No error message is read from a caught value.
    expect(source).not.toMatch(/error\.message/);
    expect(source).not.toMatch(/String\(error\)/);
  });

  it("adds no second mutation route for avatars", () => {
    const files = filesUnder("src/app/api/profile");

    expect(files).toHaveLength(1);
    expect(files[0]).toContain("route.ts");
  });
});
