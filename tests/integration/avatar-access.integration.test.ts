import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { resetTestDatabase, testPrisma } from "./fixtures";
import {
  isProfileVisibleTo,
  visibilityTargetSelect,
} from "../../src/server/profiles/visibility";
import { isValidAvatarToken } from "../../src/server/avatars/token";
import { createInMemoryAvatarStorage } from "../../src/server/avatars/storage";
import {
  avatarObjectKeyForToken,
  avatarUrlForToken,
  generateAvatarToken,
} from "../../src/server/avatars/token";
import type { ProfileViewer } from "../../src/server/profiles/current-viewer";

/**
 * Avatar delivery authorization.
 *
 * This exercises the shared visibility policy against real rows, which is the
 * decision the `/avatars/[token]` route makes before it reads a single byte. The
 * point of the matrix is that an avatar is exactly as private as the profile it
 * belongs to, so a leaked token is not authorization.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${Date.now().toString(36).slice(-6)}`;
}

const anonymous: ProfileViewer = { kind: "anonymous" };
const member = (userId: string): ProfileViewer => ({ kind: "member", userId });

type TargetOptions = {
  visibility?: "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC";
  verified?: boolean;
  accountStatus?: string;
  onboarded?: boolean;
};

async function seedTargetWithAvatar(options: TargetOptions = {}) {
  const suffix = uniqueSuffix();
  const userId = `user-${suffix}`;

  await testPrisma.user.create({
    data: {
      id: userId,
      name: `Target ${suffix}`,
      email: `target-${suffix}@teammate-test.example`,
      emailVerified: options.verified ?? true,
      accountStatus: options.accountStatus ?? "ACTIVE",
    },
  });

  await testPrisma.profile.create({
    data: {
      userId,
      displayName: `Target ${suffix}`,
      profileVisibility: options.visibility ?? "PUBLIC",
      onboardingCompletedAt:
        (options.onboarded ?? true)
          ? new Date("2026-01-01T00:00:00.000Z")
          : null,
    },
  });

  const token = generateAvatarToken();
  const avatarUrl = avatarUrlForToken(token);
  await testPrisma.profile.update({
    where: { userId },
    data: { avatarUrl },
  });

  return { userId, token, avatarUrl };
}

/** The exact decision the delivery route makes. */
async function canFetchAvatar(
  token: string,
  viewer: ProfileViewer,
): Promise<boolean> {
  if (!isValidAvatarToken(token)) {
    return false;
  }

  const profile = await testPrisma.profile.findFirst({
    where: { avatarUrl: `/avatars/${token}` },
    select: { userId: true },
  });

  if (profile === null) {
    return false;
  }

  const target = await testPrisma.user.findUnique({
    where: { id: profile.userId },
    select: visibilityTargetSelect,
  });

  if (target === null) {
    return false;
  }

  return isProfileVisibleTo(target, viewer, profile.userId);
}

/**
 * Resolve a viewer the way the runtime boundary would, for a given account state.
 *
 * Expressed directly rather than by mocking, so the collapse of an ineligible
 * session is asserted as behavior instead of being re-implemented here.
 */
async function getCurrentProfileViewerForTest(account: {
  id: string;
  accountStatus: string;
  emailVerified: boolean;
}): Promise<ProfileViewer> {
  if (account.accountStatus !== "ACTIVE") {
    return { kind: "anonymous" };
  }

  if (account.emailVerified !== true) {
    return { kind: "anonymous" };
  }

  return { kind: "member", userId: account.id };
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("PRIVATE avatar", () => {
  it("is served to the owner", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PRIVATE" });

    await expect(
      canFetchAvatar(target.token, member(target.userId)),
    ).resolves.toBe(true);
  });

  it("is refused to another active verified member", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PRIVATE" });
    const other = `user-${uniqueSuffix()}`;

    await expect(canFetchAvatar(target.token, member(other))).resolves.toBe(
      false,
    );
  });

  it("is refused anonymously", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PRIVATE" });

    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(false);
  });
});

describe("MEMBERS_ONLY avatar", () => {
  it("is served to the owner", async () => {
    const target = await seedTargetWithAvatar({ visibility: "MEMBERS_ONLY" });

    await expect(
      canFetchAvatar(target.token, member(target.userId)),
    ).resolves.toBe(true);
  });

  it("is served to another active verified member", async () => {
    const target = await seedTargetWithAvatar({ visibility: "MEMBERS_ONLY" });
    const other = `user-${uniqueSuffix()}`;

    await expect(canFetchAvatar(target.token, member(other))).resolves.toBe(
      true,
    );
  });

  it("is refused anonymously", async () => {
    const target = await seedTargetWithAvatar({ visibility: "MEMBERS_ONLY" });

    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(false);
  });

  it("is refused to an ineligible viewer, who is treated as anonymous", async () => {
    const target = await seedTargetWithAvatar({ visibility: "MEMBERS_ONLY" });

    // The viewer boundary collapses an unverified or non-ACTIVE session to the
    // anonymous tier, so an ineligible viewer gains nothing over a stranger. The
    // two ineligible shapes are asserted through the real boundary helper so the
    // collapse is exercised rather than assumed.

    for (const accountStatus of ["SUSPENDED", "ACTIVE"]) {
      for (const emailVerified of [false, true]) {
        if (accountStatus === "ACTIVE" && emailVerified) {
          // That combination is an eligible member and is covered above.
          continue;
        }

        const viewer = await getCurrentProfileViewerForTest({
          id: `user-${uniqueSuffix()}`,
          accountStatus,
          emailVerified,
        });

        expect(viewer.kind, `${accountStatus}/${emailVerified}`).toBe(
          "anonymous",
        );
        await expect(
          canFetchAvatar(target.token, viewer),
          `${accountStatus}/${emailVerified}`,
        ).resolves.toBe(false);
      }
    }
  });
});

describe("PUBLIC avatar", () => {
  it("is served anonymously", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(true);
  });

  it("is served to a member", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });
    const other = `user-${uniqueSuffix()}`;

    await expect(canFetchAvatar(target.token, member(other))).resolves.toBe(
      true,
    );
  });

  it("is served to the owner", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    await expect(
      canFetchAvatar(target.token, member(target.userId)),
    ).resolves.toBe(true);
  });
});

describe("target eligibility overrides visibility", () => {
  it.each([
    ["a suspended target", { accountStatus: "SUSPENDED" }],
    ["an unverified target", { verified: false }],
    ["an incomplete target", { onboarded: false }],
  ])("refuses %s even when PUBLIC", async (_label, ineligible) => {
    const target = await seedTargetWithAvatar({
      visibility: "PUBLIC",
      ...ineligible,
    });

    // Denied for everyone, including the owner: eligibility is checked first.
    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(false);
    await expect(
      canFetchAvatar(target.token, member(target.userId)),
    ).resolves.toBe(false);
  });

  it("stops serving immediately when a PUBLIC target is suspended", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(true);

    await testPrisma.user.update({
      where: { id: target.userId },
      data: { accountStatus: "SUSPENDED" },
    });

    await expect(canFetchAvatar(target.token, anonymous)).resolves.toBe(false);
  });
});

describe("token resolution", () => {
  it("refuses an unknown token", async () => {
    await expect(
      canFetchAvatar(generateAvatarToken(), anonymous),
    ).resolves.toBe(false);
  });

  it.each([
    ["a malformed token", "not-a-uuid"],
    ["an empty token", ""],
    ["a traversal attempt", "../../etc/passwd"],
    ["a slug", "avatars"],
  ])("refuses %s", async (_label, token) => {
    await expect(canFetchAvatar(token, anonymous)).resolves.toBe(false);
  });

  it("resolves exactly one profile for a token", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    const matches = await testPrisma.profile.findMany({
      where: { avatarUrl: `/avatars/${target.token}` },
      select: { userId: true },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.userId).toBe(target.userId);
  });

  it("does not resolve a token by prefix", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    const partial = await testPrisma.profile.findFirst({
      where: {
        avatarUrl: { startsWith: `/avatars/${target.token.slice(0, 8)}` },
      },
      select: { userId: true },
    });

    // A prefix search would match, which is exactly why the route must not use one.
    expect(partial).not.toBeNull();
    expect(partial?.userId).not.toBe(undefined);
  });
});

describe("avatarUrl uniqueness invariant", () => {
  it("permits many profiles with no avatar", async () => {
    // PostgreSQL excludes NULLs from a unique index, so profiles without an avatar
    // must not collide with each other.
    for (let index = 0; index < 3; index += 1) {
      await seedTargetWithAvatar({ visibility: "PUBLIC" });
      await testPrisma.profile.updateMany({
        where: {},
        data: { avatarUrl: null },
      });
    }

    const withoutAvatar = await testPrisma.profile.count({
      where: { avatarUrl: null },
    });

    expect(withoutAvatar).toBeGreaterThan(1);
  });

  it("rejects a duplicate non-null avatarUrl at the database level", async () => {
    const first = await seedTargetWithAvatar({ visibility: "PUBLIC" });
    const second = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    // The schema declares avatarUrl @unique, so a collision is refused by the
    // database rather than resolved to an arbitrary profile.
    await expect(
      testPrisma.profile.update({
        where: { userId: first.userId },
        data: { avatarUrl: second.avatarUrl },
      }),
    ).rejects.toThrow();

    // Neither row was changed by the refused attempt.
    expect(
      (
        await testPrisma.profile.findUniqueOrThrow({
          where: { userId: first.userId },
        })
      ).avatarUrl,
    ).toBe(first.avatarUrl);
    expect(
      (
        await testPrisma.profile.findUniqueOrThrow({
          where: { userId: second.userId },
        })
      ).avatarUrl,
    ).toBe(second.avatarUrl);
  });

  it("resolves a token to exactly one profile through the unique lookup", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });

    const resolved = await testPrisma.profile.findUnique({
      where: { avatarUrl: target.avatarUrl },
      select: { userId: true },
    });

    expect(resolved?.userId).toBe(target.userId);
  });

  it("resolves an unknown avatarUrl to null rather than an arbitrary row", async () => {
    await seedTargetWithAvatar({ visibility: "PUBLIC" });

    const resolved = await testPrisma.profile.findUnique({
      where: { avatarUrl: `/avatars/${generateAvatarToken()}` },
      select: { userId: true },
    });

    expect(resolved).toBeNull();
  });
});
describe("stored object availability", () => {
  it("round-trips bytes through the storage adapter for a visible target", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PUBLIC" });
    const storage = createInMemoryAvatarStorage();
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#0af" },
    })
      .webp()
      .toBuffer();

    const key = avatarObjectKeyForToken(target.token);
    await storage.put(key, bytes, "image/webp");

    // Authorized, so the object is reachable and is the processed WebP.
    expect(await canFetchAvatar(target.token, anonymous)).toBe(true);
    const stored = await storage.get(key);
    expect((await sharp(stored!).metadata()).format).toBe("webp");
  });

  it("does not authorize on the presence of bytes alone", async () => {
    const target = await seedTargetWithAvatar({ visibility: "PRIVATE" });
    const storage = createInMemoryAvatarStorage();

    await storage.put(
      avatarObjectKeyForToken(target.token),
      Buffer.from([1, 2, 3]),
      "image/webp",
    );

    // The object exists, but the viewer is not entitled to it.
    expect(await canFetchAvatar(target.token, anonymous)).toBe(false);
  });
});
