import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { testPrisma } from "./fixtures";
import { getOnboardingStateForSession } from "../../src/server/profiles/onboarding";
import {
  getOwnProfileForSession,
  ProfileNotOnboardedError,
  updateOwnProfileForSession,
} from "../../src/server/profiles/own-profile";

/**
 * Own-profile read/write against real PostgreSQL.
 *
 * The session is constructed directly so the ACTIVE + verified + onboarded
 * policy can be exercised without a full Better Auth round trip. The user
 * identity always comes from the session object, which is what makes the
 * cross-user cases meaningful.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${randomUUID().slice(0, 8)}`;
}

type SeededUser = {
  id: string;
  email: string;
  session: {
    user: { id: string; accountStatus: string; emailVerified: boolean };
  } | null;
  profileId: string;
};

async function seedUser(
  options: {
    onboarded?: boolean;
    emailVerified?: boolean;
    accountStatus?: string;
  } = {},
): Promise<SeededUser> {
  const suffix = uniqueSuffix();
  const id = `user-${suffix}`;
  const email = `profile-${suffix}@teammate-test.example`;
  const onboarded = options.onboarded ?? true;

  await testPrisma.user.create({
    data: {
      id,
      name: `Seeded ${suffix}`,
      email,
      emailVerified: options.emailVerified ?? true,
      accountStatus: options.accountStatus ?? "ACTIVE",
    },
  });

  await testPrisma.profile.create({
    data: {
      userId: id,
      displayName: "Seeded Name",
      onboardingCompletedAt: onboarded ? new Date() : null,
    },
  });

  return {
    id,
    email,
    session: {
      user: {
        id,
        accountStatus: options.accountStatus ?? "ACTIVE",
        emailVerified: options.emailVerified ?? true,
      },
    },
    profileId: id,
  };
}

const VALID = {
  displayName: "Ada Lovelace",
  headline: "Engine enthusiast",
  bio: "A short biography.",
  availabilityHoursPerWeek: 12,
  timezone: "Europe/London",
  profileVisibility: "PRIVATE" as const,
};

beforeEach(async () => {
  const { resetTestDatabase } = await import("./fixtures");
  await resetTestDatabase();
});

afterAll(async () => {
  const { resetTestDatabase } = await import("./fixtures");
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("own profile read", () => {
  it("returns the current session user's editable fields", async () => {
    const seeded = await seedUser();

    const profile = await getOwnProfileForSession(seeded.session, testPrisma);

    expect(profile).toEqual({
      displayName: "Seeded Name",
      headline: null,
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
      profileVisibility: "PRIVATE",
    });
  });

  it("never exposes the server-owned avatar or protected fields", async () => {
    const seeded = await seedUser();
    await testPrisma.profile.update({
      where: { userId: seeded.id },
      data: { avatarUrl: "https://cdn.example/a.png" },
    });

    const profile = await getOwnProfileForSession(seeded.session, testPrisma);

    expect(profile).not.toHaveProperty("avatarUrl");
    expect(profile).not.toHaveProperty("userId");
    expect(profile).not.toHaveProperty("onboardingCompletedAt");
    expect(profile).not.toHaveProperty("globalRole");
    expect(profile).not.toHaveProperty("accountStatus");
  });

  it("refuses a user who has not completed onboarding", async () => {
    const seeded = await seedUser({ onboarded: false });

    await expect(
      getOwnProfileForSession(seeded.session, testPrisma),
    ).rejects.toBeInstanceOf(ProfileNotOnboardedError);
  });

  it("routes a signed-up user with no profile row to onboarding", async () => {
    const suffix = uniqueSuffix();
    const id = `user-${suffix}`;
    await testPrisma.user.create({
      data: {
        id,
        name: "No Profile",
        email: `nop-${suffix}@teammate-test.example`,
        emailVerified: true,
      },
    });

    const session = {
      user: { id, accountStatus: "ACTIVE", emailVerified: true },
    };

    // Onboarding is the only path that creates a Profile, so a missing row is
    // the ordinary pre-onboarding state, not a broken invariant.
    await expect(
      getOwnProfileForSession(session, testPrisma),
    ).rejects.toBeInstanceOf(ProfileNotOnboardedError);
  });

  it("rejects a suspended and an unverified session", async () => {
    const suspended = await seedUser({ accountStatus: "SUSPENDED" });
    const unverified = await seedUser({ emailVerified: false });

    await expect(
      getOwnProfileForSession(suspended.session, testPrisma),
    ).rejects.toThrowError("Authentication required");
    await expect(
      getOwnProfileForSession(unverified.session, testPrisma),
    ).rejects.toThrowError("Email verification required");
    await expect(
      getOwnProfileForSession(null, testPrisma),
    ).rejects.toThrowError("Authentication required");
  });
});

describe("own profile update", () => {
  it("persists every approved editable field", async () => {
    const seeded = await seedUser();

    const result = await updateOwnProfileForSession(
      seeded.session,
      { ...VALID, profileVisibility: "MEMBERS_ONLY" },
      testPrisma,
    );

    expect(result).toEqual({
      displayName: "Ada Lovelace",
      headline: "Engine enthusiast",
      bio: "A short biography.",
      availabilityHoursPerWeek: 12,
      timezone: "Europe/London",
      profileVisibility: "MEMBERS_ONLY",
    });

    const stored = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });

    expect(stored.displayName).toBe("Ada Lovelace");
    expect(stored.profileVisibility).toBe("MEMBERS_ONLY");
    // Onboarding completion and server-owned fields are untouched.
    expect(stored.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(stored.avatarUrl).toBeNull();
  });

  it("trims the display name and normalizes empty optional fields to null", async () => {
    const seeded = await seedUser();
    await testPrisma.profile.update({
      where: { userId: seeded.id },
      data: {
        headline: "old",
        bio: "old bio",
        availabilityHoursPerWeek: 5,
        timezone: "UTC",
      },
    });

    await updateOwnProfileForSession(
      seeded.session,
      {
        ...VALID,
        displayName: "   Grace Hopper   ",
        headline: "   ",
        bio: "",
        availabilityHoursPerWeek: "",
        timezone: "  ",
      },
      testPrisma,
    );

    const stored = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });

    expect(stored.displayName).toBe("Grace Hopper");
    expect(stored.headline).toBeNull();
    expect(stored.bio).toBeNull();
    expect(stored.availabilityHoursPerWeek).toBeNull();
    expect(stored.timezone).toBeNull();
  });

  it("accepts the inclusive availability boundaries and persists them", async () => {
    const seeded = await seedUser();

    for (const hours of [0, 168]) {
      await updateOwnProfileForSession(
        seeded.session,
        { ...VALID, availabilityHoursPerWeek: hours },
        testPrisma,
      );

      const stored = await testPrisma.profile.findUniqueOrThrow({
        where: { userId: seeded.id },
      });
      expect(stored.availabilityHoursPerWeek).toBe(hours);
    }
  });

  it("accepts all approved visibility values", async () => {
    const seeded = await seedUser();

    for (const value of ["PRIVATE", "MEMBERS_ONLY", "PUBLIC"] as const) {
      await updateOwnProfileForSession(
        seeded.session,
        { ...VALID, profileVisibility: value },
        testPrisma,
      );

      const stored = await testPrisma.profile.findUniqueOrThrow({
        where: { userId: seeded.id },
      });
      expect(stored.profileVisibility).toBe(value);
    }
  });

  it("rejects invalid input before any database write", async () => {
    const seeded = await seedUser();
    const before = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });

    for (const input of [
      { ...VALID, displayName: "a" },
      { ...VALID, headline: "h".repeat(121) },
      { ...VALID, bio: "b".repeat(2001) },
      { ...VALID, availabilityHoursPerWeek: -1 },
      { ...VALID, availabilityHoursPerWeek: 169 },
      { ...VALID, availabilityHoursPerWeek: 1.5 },
      { ...VALID, timezone: "Not/AZone" },
      { ...VALID, profileVisibility: "ADMIN" },
    ]) {
      await expect(
        updateOwnProfileForSession(seeded.session, input, testPrisma),
      ).rejects.toMatchObject({ name: "InvalidProfileInputError" });
    }

    const after = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });
    expect(after).toEqual(before);
  });

  it("cannot modify another user's profile", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const otherBefore = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: other.id },
    });

    await updateOwnProfileForSession(
      owner.session,
      { ...VALID, displayName: "Owner Change" },
      testPrisma,
    );

    const otherAfter = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: other.id },
    });
    const ownerAfter = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: owner.id },
    });

    expect(otherAfter).toEqual(otherBefore);
    expect(otherAfter.displayName).toBe("Seeded Name");
    expect(ownerAfter.displayName).toBe("Owner Change");
  });

  it("ignores and rejects protected fields in the payload", async () => {
    const seeded = await seedUser();
    const completedAt = new Date("2026-02-02T08:00:00.000Z");
    await testPrisma.profile.update({
      where: { userId: seeded.id },
      data: {
        avatarUrl: "https://cdn.example/original.png",
        onboardingCompletedAt: completedAt,
      },
    });

    // A payload carrying protected fields is rejected outright.
    for (const input of [
      { ...VALID, userId: "someone-else" },
      { ...VALID, avatarUrl: "https://attacker.example/x.png" },
      { ...VALID, onboardingCompletedAt: "2020-01-01T00:00:00.000Z" },
      { ...VALID, globalRole: "ADMIN" },
      { ...VALID, accountStatus: "SUSPENDED" },
    ]) {
      await expect(
        updateOwnProfileForSession(seeded.session, input, testPrisma),
      ).rejects.toMatchObject({ name: "InvalidProfileInputError" });
    }

    const stored = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });

    expect(stored.avatarUrl).toBe("https://cdn.example/original.png");
    expect(stored.onboardingCompletedAt).toEqual(completedAt);
  });

  it("refuses to update before onboarding is complete", async () => {
    const seeded = await seedUser({ onboarded: false });

    await expect(
      updateOwnProfileForSession(seeded.session, VALID, testPrisma),
    ).rejects.toBeInstanceOf(ProfileNotOnboardedError);

    const stored = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: seeded.id },
    });
    expect(stored.displayName).toBe("Seeded Name");
  });

  it("rejects a suspended, unverified, or unauthenticated mutation", async () => {
    const suspended = await seedUser({ accountStatus: "SUSPENDED" });
    const unverified = await seedUser({ emailVerified: false });

    await expect(
      updateOwnProfileForSession(suspended.session, VALID, testPrisma),
    ).rejects.toThrowError("Authentication required");
    await expect(
      updateOwnProfileForSession(unverified.session, VALID, testPrisma),
    ).rejects.toThrowError("Email verification required");
    await expect(
      updateOwnProfileForSession(null, VALID, testPrisma),
    ).rejects.toThrowError("Authentication required");

    for (const seeded of [suspended, unverified]) {
      const stored = await testPrisma.profile.findUniqueOrThrow({
        where: { userId: seeded.id },
      });
      expect(stored.displayName).toBe("Seeded Name");
    }
  });

  it("does not create a profile when one is missing", async () => {
    const suffix = uniqueSuffix();
    const id = `user-${suffix}`;
    await testPrisma.user.create({
      data: {
        id,
        name: "No Profile",
        email: `nop2-${suffix}@teammate-test.example`,
        emailVerified: true,
      },
    });

    const session = {
      user: { id, accountStatus: "ACTIVE", emailVerified: true },
    };

    await expect(
      updateOwnProfileForSession(session, VALID, testPrisma),
    ).rejects.toBeInstanceOf(ProfileNotOnboardedError);

    expect(await testPrisma.profile.count({ where: { userId: id } })).toBe(0);
  });

  it("leaves the signup User.name untouched when the display name changes", async () => {
    const seeded = await seedUser();
    const before = await testPrisma.user.findUniqueOrThrow({
      where: { id: seeded.id },
    });

    await updateOwnProfileForSession(
      seeded.session,
      { ...VALID, displayName: "Changed Display Name" },
      testPrisma,
    );

    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: seeded.id },
    });

    expect(after.name).toBe(before.name);
    expect(
      (
        await testPrisma.profile.findUniqueOrThrow({
          where: { userId: seeded.id },
        })
      ).displayName,
    ).toBe("Changed Display Name");
  });

  it("preserves the onboarding read model after a profile edit", async () => {
    const seeded = await seedUser();

    await updateOwnProfileForSession(
      seeded.session,
      { ...VALID, displayName: "Onboarded Still" },
      testPrisma,
    );

    const state = await getOnboardingStateForSession(
      seeded.session as Parameters<typeof getOnboardingStateForSession>[0],
      testPrisma,
    );

    expect(state.onboardingComplete).toBe(true);
    expect(state.displayName).toBe("Onboarded Still");
  });
});
