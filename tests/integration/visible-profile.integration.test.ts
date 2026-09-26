import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase, testPrisma } from "./fixtures";
import {
  isValidProfileLocator,
  readVisibleProfile,
  type VisibleProfileDatabase,
} from "../../src/server/profiles/visible-profile";
import { seedStarterTaxonomy } from "../../src/server/taxonomy/seed-taxonomy";
import type { ProfileViewer } from "../../src/server/profiles/current-viewer";

/**
 * Profile visibility against real PostgreSQL, on the guarded `teammate_test`
 * database only.
 *
 * These tests exercise the actual Prisma selects, so they can prove things a stub
 * cannot: that `yearsExperience` stays in the database while being absent from the
 * projection, that a visibility change takes effect immediately, and that
 * suspending a target closes access without any other observable difference.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${Date.now().toString(36).slice(-6)}`;
}

const database: VisibleProfileDatabase = testPrisma;

const anonymous: ProfileViewer = { kind: "anonymous" };
const member = (userId: string): ProfileViewer => ({ kind: "member", userId });

type SeedOptions = {
  verified?: boolean;
  accountStatus?: string;
  onboarded?: boolean;
  withProfile?: boolean;
  visibility?: "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC";
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  timezone?: string | null;
  availabilityHoursPerWeek?: number | null;
};

/** Create a user, optionally with an onboarded profile. */
async function seedAccount(options: SeedOptions = {}) {
  const suffix = uniqueSuffix();
  const id = `user-${suffix}`;

  await testPrisma.user.create({
    data: {
      id,
      name: `Viewer ${suffix}`,
      email: `viewer-${suffix}@teammate-test.example`,
      emailVerified: options.verified ?? true,
      accountStatus: options.accountStatus ?? "ACTIVE",
    },
  });

  if (options.withProfile ?? true) {
    await testPrisma.profile.create({
      data: {
        userId: id,
        displayName: options.displayName ?? `Viewer ${suffix}`,
        headline: options.headline ?? null,
        bio: options.bio ?? null,
        avatarUrl: options.avatarUrl ?? null,
        timezone: options.timezone ?? "Europe/London",
        availabilityHoursPerWeek: options.availabilityHoursPerWeek ?? 20,
        profileVisibility: options.visibility ?? "PUBLIC",
        onboardingCompletedAt:
          (options.onboarded ?? true)
            ? new Date("2026-01-01T00:00:00.000Z")
            : null,
      },
    });
  }

  return id;
}

/** An eligible target with one skill and one interest assigned. */
async function seedTargetWithAssignments(): Promise<string> {
  await seedStarterTaxonomy(testPrisma);

  const id = await seedAccount({
    displayName: "Ada Lovelace",
    headline: "Countess and engineer",
    bio: "Writes notes about analytical engines.",
    visibility: "PUBLIC",
    timezone: "Europe/London",
    availabilityHoursPerWeek: 20,
  });

  const react = await testPrisma.skill.findUniqueOrThrow({
    where: { slug: "react" },
  });
  const python = await testPrisma.skill.findUniqueOrThrow({
    where: { slug: "python" },
  });
  const openSource = await testPrisma.interest.findUniqueOrThrow({
    where: { slug: "open-source" },
  });

  await testPrisma.userSkill.create({
    data: {
      userId: id,
      skillId: react.id,
      proficiencyLevel: "ADVANCED",
      yearsExperience: 9,
    },
  });
  await testPrisma.userSkill.create({
    data: {
      userId: id,
      skillId: python.id,
      proficiencyLevel: "EXPERT",
      yearsExperience: 0,
    },
  });
  await testPrisma.userInterest.create({
    data: { userId: id, interestId: openSource.id },
  });

  return id;
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("target eligibility", () => {
  it("serves an active verified onboarded target with a profile", async () => {
    const id = await seedAccount({ visibility: "PUBLIC" });

    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.not.toBeNull();
  });

  it.each([
    ["a suspended target", { accountStatus: "SUSPENDED" }],
    ["an unverified target", { verified: false }],
    ["a target who has not onboarded", { onboarded: false }],
    ["a target with no profile row", { withProfile: false }],
  ])(
    "hides %s from an owner, a member, and an anonymous viewer",
    async (_label, ineligible) => {
      const id = await seedAccount({ visibility: "PUBLIC", ...ineligible });

      for (const viewer of [
        member(id),
        member(await seedAccount()),
        anonymous,
      ]) {
        await expect(
          readVisibleProfile(id, viewer, database),
          `${_label}`,
        ).resolves.toBeNull();
      }
    },
  );

  it("hides a nonexistent user", async () => {
    await expect(
      readVisibleProfile("user-does-not-exist", anonymous, database),
    ).resolves.toBeNull();
  });

  it("closes access immediately when a target is suspended", async () => {
    const id = await seedAccount({ visibility: "PUBLIC" });

    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.not.toBeNull();

    await testPrisma.user.update({
      where: { id },
      data: { accountStatus: "SUSPENDED" },
    });

    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.toBeNull();
    // Even the owner loses access, because eligibility is checked first.
    await expect(
      readVisibleProfile(id, member(id), database),
    ).resolves.toBeNull();
  });

  it("closes access immediately when a target's verification is withdrawn", async () => {
    const id = await seedAccount({ visibility: "PUBLIC" });

    await testPrisma.user.update({
      where: { id },
      data: { emailVerified: false },
    });

    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.toBeNull();
  });
});

describe("visibility transitions", () => {
  it("applies each visibility setting to every viewer kind", async () => {
    const target = await seedAccount({ visibility: "PRIVATE" });
    const other = await seedAccount();
    const matrix: Record<string, Record<string, boolean>> = {
      PRIVATE: { owner: true, member: false, anonymous: false },
      MEMBERS_ONLY: { owner: true, member: true, anonymous: false },
      PUBLIC: { owner: true, member: true, anonymous: true },
    };

    for (const [visibility, expected] of Object.entries(matrix)) {
      await testPrisma.profile.update({
        where: { userId: target },
        data: { profileVisibility: visibility as "PRIVATE" },
      });

      const results = {
        owner:
          (await readVisibleProfile(target, member(target), database)) !== null,
        member:
          (await readVisibleProfile(target, member(other), database)) !== null,
        anonymous:
          (await readVisibleProfile(target, anonymous, database)) !== null,
      };

      expect(results, visibility).toEqual(expected);
    }
  });

  it("denies a member the same PRIVATE profile the owner can see", async () => {
    const target = await seedAccount({ visibility: "PRIVATE" });
    const other = await seedAccount();

    await expect(
      readVisibleProfile(target, member(target), database),
    ).resolves.not.toBeNull();
    await expect(
      readVisibleProfile(target, member(other), database),
    ).resolves.toBeNull();
  });

  it("never lets a viewer reach a target by using a different locator", async () => {
    const privateTarget = await seedAccount({ visibility: "PRIVATE" });
    const publicTarget = await seedAccount({ visibility: "PUBLIC" });
    const other = await seedAccount();

    // The viewer is a legitimate member, so the public profile resolves...
    await expect(
      readVisibleProfile(publicTarget, member(other), database),
    ).resolves.not.toBeNull();

    // ...but swapping the locator to the private target is refused, which is the
    // IDOR case: knowing the id is not authorization.
    await expect(
      readVisibleProfile(privateTarget, member(other), database),
    ).resolves.toBeNull();
  });
});

describe("safe projection", () => {
  it("returns exactly the approved field set", async () => {
    const id = await seedTargetWithAssignments();

    const profile = await readVisibleProfile(id, anonymous, database);

    expect(Object.keys(profile ?? {}).sort()).toEqual([
      "avatarUrl",
      "bio",
      "displayName",
      "headline",
      "interests",
      "skills",
    ]);
  });

  it("returns skill slug, name, category, and proficiency only", async () => {
    const id = await seedTargetWithAssignments();

    const profile = await readVisibleProfile(id, anonymous, database);

    // "Frontend" sorts before "Programming Languages", so React comes first.
    expect(profile?.skills).toEqual([
      {
        slug: "react",
        name: "React",
        category: "Frontend",
        proficiencyLevel: "ADVANCED",
      },
      {
        slug: "python",
        name: "Python",
        category: "Programming Languages",
        proficiencyLevel: "EXPERT",
      },
    ]);
  });

  it("returns interest slug and name only", async () => {
    const id = await seedTargetWithAssignments();

    const profile = await readVisibleProfile(id, anonymous, database);

    expect(profile?.interests).toEqual([
      { slug: "open-source", name: "Open Source" },
    ]);
  });

  it("keeps yearsExperience in the database but out of the projection", async () => {
    const id = await seedTargetWithAssignments();

    const stored = await testPrisma.userSkill.findMany({
      where: { userId: id },
      select: { yearsExperience: true },
    });
    expect(stored.map((row) => row.yearsExperience).sort()).toEqual([0, 9]);

    const profile = await readVisibleProfile(id, anonymous, database);

    expect(JSON.stringify(profile)).not.toContain("yearsExperience");
    expect(
      profile?.skills.every((skill) => !("yearsExperience" in skill)),
    ).toBe(true);
  });

  it("excludes timezone, availability, and other private preferences", async () => {
    const id = await seedAccount({
      visibility: "PUBLIC",
      timezone: "Europe/London",
      availabilityHoursPerWeek: 20,
    });

    const serialized = JSON.stringify(
      await readVisibleProfile(id, anonymous, database),
    );

    for (const forbidden of [
      "Europe/London",
      "availabilityHoursPerWeek",
      "timezone",
      "20",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("excludes identifiers, auth fields, and taxonomy keys", async () => {
    const id = await seedTargetWithAssignments();

    const serialized = JSON.stringify(
      await readVisibleProfile(id, anonymous, database),
    );

    for (const forbidden of [
      id,
      "userId",
      "email",
      "emailVerified",
      "globalRole",
      "accountStatus",
      "onboardingCompletedAt",
      "nameKey",
      "createdAt",
      "updatedAt",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("gives the owner the same safe projection as any other viewer", async () => {
    const id = await seedTargetWithAssignments();
    await testPrisma.profile.update({
      where: { userId: id },
      data: { profileVisibility: "PRIVATE" },
    });

    const asOwner = await readVisibleProfile(id, member(id), database);

    // The owner does not receive their timezone or availability through this
    // route; full private data stays on /app/profile.
    expect(JSON.stringify(asOwner)).not.toContain("Europe/London");
    expect(asOwner?.displayName).toBe("Ada Lovelace");
  });

  it("represents absent optional data as null and empty lists", async () => {
    const id = await seedAccount({
      visibility: "PUBLIC",
      headline: null,
      bio: null,
      avatarUrl: null,
    });

    await expect(readVisibleProfile(id, anonymous, database)).resolves.toEqual({
      displayName: expect.any(String),
      headline: null,
      bio: null,
      avatarUrl: null,
      skills: [],
      interests: [],
    });
  });
});

describe("ordering", () => {
  it("orders skills by category with nulls last, then by name", async () => {
    await seedStarterTaxonomy(testPrisma);
    const id = await seedAccount({ visibility: "PUBLIC" });

    const uncategorized = await testPrisma.skill.create({
      data: {
        slug: `uncategorized-${uniqueSuffix()}`,
        name: "Zzz Unlisted Craft",
        nameKey: "zzz unlisted craft",
        category: null,
      },
    });

    for (const [slug, proficiencyLevel] of [
      ["react", "ADVANCED"],
      ["python", "EXPERT"],
      ["css", "BEGINNER"],
    ] as const) {
      const skill = await testPrisma.skill.findUniqueOrThrow({
        where: { slug },
      });
      await testPrisma.userSkill.create({
        data: { userId: id, skillId: skill.id, proficiencyLevel },
      });
    }
    await testPrisma.userSkill.create({
      data: {
        userId: id,
        skillId: uncategorized.id,
        proficiencyLevel: "INTERMEDIATE",
      },
    });

    const profile = await readVisibleProfile(id, anonymous, database);

    // Frontend first (CSS, React), then Programming Languages (Python), then the
    // uncategorized entry last.
    expect(profile?.skills.map((skill) => skill.name)).toEqual([
      "CSS",
      "React",
      "Python",
      "Zzz Unlisted Craft",
    ]);
  });

  it("orders interests by name", async () => {
    await seedStarterTaxonomy(testPrisma);
    const id = await seedAccount({ visibility: "PUBLIC" });

    for (const slug of ["robotics", "data-science", "open-source"]) {
      const interest = await testPrisma.interest.findUniqueOrThrow({
        where: { slug },
      });
      await testPrisma.userInterest.create({
        data: { userId: id, interestId: interest.id },
      });
    }

    const profile = await readVisibleProfile(id, anonymous, database);

    expect(profile?.interests.map((interest) => interest.name)).toEqual([
      "Data Science",
      "Open Source",
      "Robotics",
    ]);
  });
});

describe("locator handling against the real schema", () => {
  it("resolves a locator that matches a real stored id", async () => {
    const id = await seedAccount({ visibility: "PUBLIC" });

    expect(isValidProfileLocator(id)).toBe(true);
    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.not.toBeNull();
  });

  it.each([
    ["an empty locator", ""],
    ["a whitespace-only locator of legal length", "abc"],
    [
      "a UUID-shaped locator with no user",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    ],
    ["a path-traversal attempt", "../../etc/passwd"],
    ["a very long locator", "a".repeat(500)],
  ])("returns not-found for %s", async (_label, locator) => {
    await expect(
      readVisibleProfile(locator, anonymous, database),
    ).resolves.toBeNull();
  });

  it("returns not-found for a control-character locator", async () => {
    await expect(
      readVisibleProfile(`a${String.fromCharCode(0)}b`, anonymous, database),
    ).resolves.toBeNull();
  });
});

describe("read-only guarantee", () => {
  it("does not change any row while serving a profile", async () => {
    const id = await seedTargetWithAssignments();

    const before = await snapshot();

    await readVisibleProfile(id, anonymous, database);
    await readVisibleProfile(id, member(id), database);
    await readVisibleProfile("user-nobody", anonymous, database);

    expect(await snapshot()).toEqual(before);
  });

  it("does not create a Profile row for a user who has none", async () => {
    const id = await seedAccount({ withProfile: false });

    await expect(
      readVisibleProfile(id, anonymous, database),
    ).resolves.toBeNull();
    expect(await testPrisma.profile.count()).toBe(0);
  });
});

async function snapshot() {
  const [users, profiles, userSkills, userInterests, skills, interests] =
    await Promise.all([
      testPrisma.user.findMany({ orderBy: { id: "asc" } }),
      testPrisma.profile.findMany({ orderBy: { userId: "asc" } }),
      testPrisma.userSkill.findMany({ orderBy: { skillId: "asc" } }),
      testPrisma.userInterest.findMany({ orderBy: { interestId: "asc" } }),
      testPrisma.skill.findMany({ orderBy: { id: "asc" } }),
      testPrisma.interest.findMany({ orderBy: { id: "asc" } }),
    ]);

  return { users, profiles, userSkills, userInterests, skills, interests };
}
