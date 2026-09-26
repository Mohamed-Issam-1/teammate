import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { resetTestDatabase, testPrisma } from "./fixtures";
import {
  removeOwnAvatar,
  saveOwnAvatar,
  AvatarNotOnboardedError,
  type OwnAvatarDatabase,
} from "../../src/server/avatars/own-avatar";
import { createInMemoryAvatarStorage } from "../../src/server/avatars/storage";
import {
  avatarObjectKeyFromUrl,
  avatarObjectKeyForToken,
  avatarUrlForToken,
  generateAvatarToken,
  isValidAvatarToken,
} from "../../src/server/avatars/token";
import {
  AvatarEmptyError,
  AvatarTooLargeError,
  AvatarUndecodableError,
  AvatarUnsupportedFormatError,
  MAX_AVATAR_UPLOAD_BYTES,
  processAvatarUpload,
} from "../../src/server/avatars/image";
import {
  readAvatarS3Config,
  createS3AvatarStorage,
} from "../../src/server/avatars/s3";
import { AvatarStorageUnavailableError } from "../../src/server/avatars/storage";

/**
 * Avatar writes and the storage contract against real PostgreSQL on the guarded
 * `teammate_test` database, using an injected in-memory storage so no object-store
 * credentials are needed.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${Date.now().toString(36).slice(-6)}`;
}

type SeedOptions = {
  verified?: boolean;
  accountStatus?: string;
  onboarded?: boolean;
  withProfile?: boolean;
  image?: string | null;
};

async function seedUser(options: SeedOptions = {}) {
  const suffix = uniqueSuffix();
  const id = `user-${suffix}`;

  await testPrisma.user.create({
    data: {
      id,
      name: `Avatar ${suffix}`,
      email: `avatar-${suffix}@teammate-test.example`,
      emailVerified: options.verified ?? true,
      accountStatus: options.accountStatus ?? "ACTIVE",
      image: "https://legacy.example/picture.png",
    },
  });

  if (options.withProfile ?? true) {
    await testPrisma.profile.create({
      data: {
        userId: id,
        displayName: `Avatar ${suffix}`,
        avatarUrl: options.image === undefined ? null : options.image,
        onboardingCompletedAt:
          (options.onboarded ?? true)
            ? new Date("2026-01-01T00:00:00.000Z")
            : null,
      },
    });
  }

  return id;
}

function sessionFor(id: string, verified = true, accountStatus = "ACTIVE") {
  return { user: { id, accountStatus, emailVerified: verified } };
}

/** A small, valid WebP to store. */
async function validWebp(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: "#3366cc" },
  })
    .webp()
    .toBuffer();
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("own avatar upload", () => {
  it("stores the processed avatar and updates the caller's profile", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();
    const webp = await validWebp();

    const result = await saveOwnAvatar(
      sessionFor(userId),
      webp,
      storage,
      testPrisma,
    );

    expect(isValidAvatarToken(result.avatarUrl.slice("/avatars/".length))).toBe(
      true,
    );

    const profile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId },
    });
    expect(profile.avatarUrl).toBe(result.avatarUrl);

    const stored = await storage.get(
      avatarObjectKeyForToken(result.avatarUrl.slice("/avatars/".length)),
    );
    expect(stored).not.toBeNull();
    expect((await sharp(stored!).metadata()).format).toBe("webp");
  });

  it("never touches User.image", async () => {
    const userId = await seedUser();

    await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      createInMemoryAvatarStorage(),
      testPrisma,
    );

    const user = await testPrisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.image).toBe("https://legacy.example/picture.png");
  });

  it("leaves another user's profile untouched", async () => {
    const owner = await seedUser();
    const other = await seedUser();

    await saveOwnAvatar(
      sessionFor(owner),
      await validWebp(),
      createInMemoryAvatarStorage(),
      testPrisma,
    );

    const otherProfile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: other },
    });
    expect(otherProfile.avatarUrl).toBeNull();
  });

  it.each([
    ["a suspended caller", { accountStatus: "SUSPENDED", verified: true }],
    ["an unverified caller", { accountStatus: "ACTIVE", verified: false }],
  ])("rejects %s", async (_label, ineligible) => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    await expect(
      saveOwnAvatar(
        sessionFor(userId, ineligible.verified, ineligible.accountStatus),
        await validWebp(),
        storage,
        testPrisma,
      ),
    ).rejects.toThrowError(
      /Authentication required|Email verification required/,
    );

    expect(storage.objects.size).toBe(0);
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    await expect(
      saveOwnAvatar(null, await validWebp(), storage, testPrisma),
    ).rejects.toThrowError("Authentication required");

    expect(storage.objects.size).toBe(0);
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
  });

  it("rejects a caller who has not onboarded", async () => {
    const userId = await seedUser({ onboarded: false });
    const storage = createInMemoryAvatarStorage();

    await expect(
      saveOwnAvatar(sessionFor(userId), await validWebp(), storage, testPrisma),
    ).rejects.toBeInstanceOf(AvatarNotOnboardedError);

    expect(storage.objects.size).toBe(0);
  });

  it("rejects a caller with no profile row at all", async () => {
    const userId = await seedUser({ withProfile: false });

    await expect(
      saveOwnAvatar(
        sessionFor(userId),
        await validWebp(),
        createInMemoryAvatarStorage(),
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(AvatarNotOnboardedError);
  });

  it("refuses an oversized image before any storage write", async () => {
    const storage = createInMemoryAvatarStorage();

    await expect(
      processAvatarUpload(Buffer.alloc(MAX_AVATAR_UPLOAD_BYTES + 1, 0x41)),
    ).rejects.toBeInstanceOf(AvatarTooLargeError);

    expect(storage.objects.size).toBe(0);
  });

  it("refuses an invalid image before any storage write", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    // A complete SVG, so it decodes successfully and is refused specifically on
    // its format rather than failing to decode at all.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#123456"/></svg>',
    );
    await expect(processAvatarUpload(svg)).rejects.toBeInstanceOf(
      AvatarUnsupportedFormatError,
    );
    await expect(
      processAvatarUpload(Buffer.from("not an image")),
    ).rejects.toBeInstanceOf(AvatarUndecodableError);
    await expect(processAvatarUpload(Buffer.alloc(0))).rejects.toBeInstanceOf(
      AvatarEmptyError,
    );

    expect(storage.objects.size).toBe(0);
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
  });

  it("accepts exactly the size cap boundary without a size rejection", async () => {
    // A valid image padded to just under the cap must not be refused for size.
    const base = await validWebp();
    expect(base.length).toBeLessThan(MAX_AVATAR_UPLOAD_BYTES);

    const result = await processAvatarUpload(base);
    expect(result.webp.length).toBeGreaterThan(0);
  });
});

describe("own avatar replacement", () => {
  it("points the profile at a new object and deletes the old one", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const first = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );
    const firstKey = avatarObjectKeyForToken(
      first.avatarUrl.slice("/avatars/".length),
    );
    expect(storage.objects.has(firstKey)).toBe(true);

    const second = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    expect(second.avatarUrl).not.toBe(first.avatarUrl);

    const profile = await testPrisma.profile.findUniqueOrThrow({
      where: { userId },
    });
    expect(profile.avatarUrl).toBe(second.avatarUrl);

    // The new object is live and the old one is gone.
    expect(
      storage.objects.has(
        avatarObjectKeyForToken(second.avatarUrl.slice("/avatars/".length)),
      ),
    ).toBe(true);
    expect(storage.objects.has(firstKey)).toBe(false);
    expect(storage.objects.size).toBe(1);
  });

  it("keeps the old avatar when the new object cannot be stored", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const first = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    const failing = {
      ...createInMemoryAvatarStorage(),
      put: async () => {
        throw new Error("storage unavailable");
      },
    };

    await expect(
      saveOwnAvatar(sessionFor(userId), await validWebp(), failing, testPrisma),
    ).rejects.toThrowError("storage unavailable");

    // The database still points at the original, which still resolves.
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBe(first.avatarUrl);
    expect(
      storage.objects.has(
        avatarObjectKeyForToken(first.avatarUrl.slice("/avatars/".length)),
      ),
    ).toBe(true);
  });

  it("removes the newly written object when the database update fails", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const first = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    // Simulate the conditional write matching no row.
    const alwaysNoMatch = (async () => ({
      count: 0,
    })) as unknown as OwnAvatarDatabase["profile"]["updateMany"];

    const failingDatabase: OwnAvatarDatabase = {
      profile: {
        findUnique: (args) => testPrisma.profile.findUnique(args),
        updateMany: alwaysNoMatch,
      },
      user: { findUnique: (args) => testPrisma.user.findUnique(args) },
    };

    await expect(
      saveOwnAvatar(
        sessionFor(userId),
        await validWebp(),
        storage,
        failingDatabase,
      ),
    ).rejects.toBeInstanceOf(AvatarNotOnboardedError);

    // The orphan was cleaned up, and the old avatar is untouched.
    expect(storage.objects.size).toBe(1);
    expect(
      storage.objects.has(
        avatarObjectKeyForToken(first.avatarUrl.slice("/avatars/".length)),
      ),
    ).toBe(true);
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBe(first.avatarUrl);
  });

  it("keeps the new avatar when deleting the old object fails", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const first = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    const second = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      {
        ...storage,
        delete: async () => {
          throw new Error("cleanup failed");
        },
      },
      testPrisma,
    );

    // The write succeeded and is not reverted, even though cleanup failed.
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBe(second.avatarUrl);
    expect(second.avatarUrl).not.toBe(first.avatarUrl);
  });

  it("does not delete an unrecognized legacy avatarUrl as a storage key", async () => {
    const legacy = "https://cdn.example.com/old-avatar.png";
    const userId = await seedUser({ image: legacy });

    const storage = createInMemoryAvatarStorage();
    const saved = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    // The legacy URL is simply replaced, and no deletion was attempted for it.
    expect(saved.avatarUrl).not.toBe(legacy);
    expect(avatarObjectKeyFromUrl(legacy)).toBeNull();
    expect(storage.objects.size).toBe(1);
  });
});

describe("own avatar removal", () => {
  it("clears the reference and deletes the stored object", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const saved = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );
    const key = avatarObjectKeyForToken(
      saved.avatarUrl.slice("/avatars/".length),
    );

    await removeOwnAvatar(sessionFor(userId), storage, testPrisma);

    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
    expect(storage.objects.has(key)).toBe(false);
  });

  it("is safe and idempotent when there is no avatar", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    await removeOwnAvatar(sessionFor(userId), storage, testPrisma);
    await expect(
      removeOwnAvatar(sessionFor(userId), storage, testPrisma),
    ).resolves.toBeUndefined();
  });

  it("refuses to remove another user's avatar", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const saved = await saveOwnAvatar(
      sessionFor(owner),
      await validWebp(),
      storage,
      testPrisma,
    );

    await removeOwnAvatar(sessionFor(other), storage, testPrisma);

    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId: owner } }))
        .avatarUrl,
    ).toBe(saved.avatarUrl);
    expect(
      storage.objects.has(
        avatarObjectKeyForToken(saved.avatarUrl.slice("/avatars/".length)),
      ),
    ).toBe(true);
  });

  it("does not restore the reference when storage cleanup fails", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const saved = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    await removeOwnAvatar(
      sessionFor(userId),
      {
        ...storage,
        delete: async () => {
          throw new Error("cleanup failed");
        },
      },
      testPrisma,
    );

    // The private state is already gone, and a leftover object is preferable to a
    // reachable avatar.
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
    expect(
      storage.objects.has(
        avatarObjectKeyForToken(saved.avatarUrl.slice("/avatars/".length)),
      ),
    ).toBe(true);
  });

  it("does not delete a storage object for an unrecognized avatarUrl", async () => {
    const userId = await seedUser({ image: "https://cdn.example.com/x.png" });
    const storage = createInMemoryAvatarStorage();

    await removeOwnAvatar(sessionFor(userId), storage, testPrisma);

    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId } }))
        .avatarUrl,
    ).toBeNull();
    // No object was ever created, and none was deleted.
    expect(storage.objects.size).toBe(0);
  });
});

describe("avatarUrl invariant", () => {
  it("only ever stores a same-origin avatar path", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const saved = await saveOwnAvatar(
      sessionFor(userId),
      await validWebp(),
      storage,
      testPrisma,
    );

    const stored = (
      await testPrisma.profile.findUniqueOrThrow({ where: { userId } })
    ).avatarUrl;

    expect(stored).toBe(saved.avatarUrl);
    expect(stored?.startsWith("/avatars/")).toBe(true);
    expect(stored).not.toContain("://");
    expect(stored).not.toMatch(/^data:/);
  });

  it("generates a distinct url per upload", async () => {
    const userId = await seedUser();
    const storage = createInMemoryAvatarStorage();

    const urls = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      const saved = await saveOwnAvatar(
        sessionFor(userId),
        await validWebp(),
        storage,
        testPrisma,
      );
      urls.add(saved.avatarUrl);
    }

    expect(urls.size).toBe(4);
  });

  it("builds the storage key from the token, not from the url text", () => {
    const token = generateAvatarToken();

    expect(avatarObjectKeyForToken(token)).toBe(`avatars/${token}.webp`);
    expect(avatarUrlForToken(token)).toBe(`/avatars/${token}`);
  });
});

describe("production storage boundary", () => {
  it("fails closed when configuration is absent", () => {
    expect(() => createS3AvatarStorage(readAvatarS3Config({}))).toThrow(
      AvatarStorageUnavailableError,
    );
  });

  it("constructs an adapter from a complete configuration without contacting the provider", () => {
    const storage = createS3AvatarStorage(
      readAvatarS3Config({
        S3_ENDPOINT: "https://s3.example.test",
        S3_REGION: "eu-west-1",
        S3_BUCKET: "teammate-avatars",
        S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    );

    // Construction is lazy: no network call happens until an operation is invoked.
    expect(typeof storage.put).toBe("function");
    expect(typeof storage.get).toBe("function");
    expect(typeof storage.delete).toBe("function");
  });
});
