import { describe, expect, it } from "vitest";

import {
  isValidProfileLocator,
  PROFILE_LOCATOR_MAX_LENGTH,
  readVisibleProfile,
  type VisibleProfileDatabase,
} from "@/server/profiles/visible-profile";
import type { ProfileViewer } from "@/server/profiles/current-viewer";

/**
 * Visibility and projection rules.
 *
 * Driven by a stub database so the whole access matrix is exercised cheaply, and
 * so the tests can assert something a real database cannot easily prove: that
 * the second, projection-bearing query is never issued for an unauthorized
 * viewer. Real PostgreSQL behavior is covered by the integration suite.
 */

const OWNER_ID = "owner-target-id";
const OTHER_ID = "other-viewer-id";

const ANONYMOUS: ProfileViewer = { kind: "anonymous" };
const member = (userId: string): ProfileViewer => ({ kind: "member", userId });

type TargetRecord = {
  accountStatus?: string;
  emailVerified?: boolean;
  profileVisibility?: "PRIVATE" | "MEMBERS_ONLY" | "PUBLIC";
  onboardingCompletedAt?: Date | null;
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  skills?: {
    slug: string;
    name: string;
    category: string | null;
    proficiencyLevel: string;
    yearsExperience?: number | null;
  }[];
  interests?: { slug: string; name: string; nameKey?: string }[];
};

/** Build a stub that answers both `user.findUnique` shapes. */
function stubFor(target: TargetRecord | null) {
  const calls: { selectKeys: string[] }[] = [];

  const database = {
    user: {
      findUnique(args: {
        where: { id: string };
        select: Record<string, unknown>;
      }) {
        const selectKeys = Object.keys(args.select);
        calls.push({ selectKeys });

        if (target === null) {
          return Promise.resolve(null);
        }

        if (selectKeys.includes("accountStatus")) {
          // Phase one: target eligibility and visibility only.
          return Promise.resolve({
            accountStatus: target.accountStatus ?? "ACTIVE",
            emailVerified: target.emailVerified ?? true,
            profile: {
              profileVisibility: target.profileVisibility ?? "PUBLIC",
              onboardingCompletedAt:
                target.onboardingCompletedAt === undefined
                  ? new Date("2026-01-01T00:00:00.000Z")
                  : target.onboardingCompletedAt,
            },
          });
        }

        // Phase two: the safe projection.
        return Promise.resolve({
          profile: {
            displayName: target.displayName ?? "Ada Lovelace",
            headline: target.headline ?? null,
            bio: target.bio ?? null,
            avatarUrl: target.avatarUrl ?? null,
          },
          userSkills: (target.skills ?? []).map((skill) => ({
            proficiencyLevel: skill.proficiencyLevel,
            skill: {
              slug: skill.slug,
              name: skill.name,
              category: skill.category,
            },
          })),
          userInterests: (target.interests ?? []).map((interest) => ({
            interest: { slug: interest.slug, name: interest.name },
          })),
        });
      },
    },
  } as unknown as VisibleProfileDatabase;

  return { database, calls };
}

const visibleTarget: TargetRecord = {
  profileVisibility: "PUBLIC",
  displayName: "Ada Lovelace",
  headline: "Countess and engineer",
  bio: "Writes notes about analytical engines.",
  avatarUrl: null,
  skills: [
    {
      slug: "typescript",
      name: "TypeScript",
      category: "Programming Languages",
      proficiencyLevel: "EXPERT",
      yearsExperience: 9,
    },
  ],
  interests: [
    { slug: "open-source", name: "Open Source", nameKey: "open source" },
  ],
};

describe("profile locator validation", () => {
  it("accepts a realistic Better Auth id", () => {
    expect(isValidProfileLocator("a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6")).toBe(
      true,
    );
  });

  it("accepts an opaque id of any shape the schema permits", () => {
    for (const value of [
      "a",
      "user-with-dashes",
      "user_with_underscores",
      "a".repeat(PROFILE_LOCATOR_MAX_LENGTH),
      "0123456789",
      "MiXeD-CaSe_99",
    ]) {
      expect(isValidProfileLocator(value), value).toBe(true);
    }
  });

  it("rejects an empty locator", () => {
    expect(isValidProfileLocator("")).toBe(false);
  });

  it("rejects a locator beyond the bound", () => {
    expect(
      isValidProfileLocator("a".repeat(PROFILE_LOCATOR_MAX_LENGTH + 1)),
    ).toBe(false);
  });

  it("rejects control characters", () => {
    // Built from char codes on purpose: a literal control character is easy to
    // lose when the source is written or reformatted, and a silently stripped
    // test string would assert nothing at all.
    const controlCodes = [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f];

    for (const code of controlCodes) {
      const value = `a${String.fromCharCode(code)}b`;
      expect(isValidProfileLocator(value), `0x${code.toString(16)}`).toBe(
        false,
      );
    }
  });

  it("does not assume a UUID, because the schema declares unbounded text", () => {
    // A real Better Auth id is not a UUID. Rejecting non-UUIDs would make every
    // legitimate profile unreachable.
    expect(isValidProfileLocator("not-a-uuid-at-all")).toBe(true);
  });
});

describe("PRIVATE visibility", () => {
  it("is visible to the owner", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OWNER_ID), database),
    ).resolves.not.toBeNull();
  });

  it("is hidden from another active verified member", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OTHER_ID), database),
    ).resolves.toBeNull();
  });

  it("is hidden from an anonymous viewer", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    await expect(
      readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    ).resolves.toBeNull();
  });
});

describe("MEMBERS_ONLY visibility", () => {
  it("is visible to the owner", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "MEMBERS_ONLY",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OWNER_ID), database),
    ).resolves.not.toBeNull();
  });

  it("is visible to another active verified member", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "MEMBERS_ONLY",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OTHER_ID), database),
    ).resolves.not.toBeNull();
  });

  it("is hidden from an anonymous viewer", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "MEMBERS_ONLY",
    });

    await expect(
      readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    ).resolves.toBeNull();
  });
});

describe("PUBLIC visibility", () => {
  it.each([
    ["the owner", () => member(OWNER_ID)],
    ["another member", () => member(OTHER_ID)],
    ["an anonymous viewer", () => ANONYMOUS],
  ])("is visible to %s", async (_label, makeViewer) => {
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "PUBLIC",
    });

    await expect(
      readVisibleProfile(OWNER_ID, makeViewer(), database),
    ).resolves.not.toBeNull();
  });
});

describe("target eligibility", () => {
  it.each([
    ["a suspended account", { accountStatus: "SUSPENDED" }],
    ["an unverified account", { emailVerified: false }],
    ["an incomplete profile", { onboardingCompletedAt: null }],
  ])("hides %s from everyone", async (_label, ineligible) => {
    for (const makeViewer of [
      () => member(OWNER_ID),
      () => member(OTHER_ID),
      () => ANONYMOUS,
    ]) {
      for (const profileVisibility of [
        "PRIVATE",
        "MEMBERS_ONLY",
        "PUBLIC",
      ] as const) {
        const { database } = stubFor({
          ...visibleTarget,
          ...ineligible,
          profileVisibility,
        });

        await expect(
          readVisibleProfile(OWNER_ID, makeViewer(), database),
          `${_label} / ${profileVisibility}`,
        ).resolves.toBeNull();
      }
    }
  });

  it("hides a missing user", async () => {
    const { database } = stubFor(null);

    await expect(
      readVisibleProfile(OWNER_ID, member(OWNER_ID), database),
    ).resolves.toBeNull();
    await expect(
      readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    ).resolves.toBeNull();
  });
});

describe("locator handling", () => {
  it("returns not-found for a malformed locator without querying", async () => {
    const { database, calls } = stubFor(visibleTarget);

    await expect(
      readVisibleProfile("", ANONYMOUS, database),
    ).resolves.toBeNull();
    await expect(
      readVisibleProfile(
        "a".repeat(PROFILE_LOCATOR_MAX_LENGTH + 1),
        ANONYMOUS,
        database,
      ),
    ).resolves.toBeNull();
    await expect(
      readVisibleProfile("a\nb", ANONYMOUS, database),
    ).resolves.toBeNull();

    // No query at all, so a malformed locator cannot be distinguished by timing
    // or by any database side effect.
    expect(calls).toHaveLength(0);
  });

  it("never fetches skills or interests for an unauthorized viewer", async () => {
    const { database, calls } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OTHER_ID), database),
    ).resolves.toBeNull();

    // Only the eligibility query ran; the projection query never happened, so no
    // assignment rows were loaded for a profile the viewer may not see.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.selectKeys).toEqual([
      "accountStatus",
      "emailVerified",
      "profile",
    ]);
  });
});

describe("safe projection", () => {
  it("returns only the approved fields", async () => {
    const { database } = stubFor(visibleTarget);

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(profile).not.toBeNull();
    expect(Object.keys(profile ?? {}).sort()).toEqual([
      "avatarUrl",
      "bio",
      "displayName",
      "headline",
      "interests",
      "skills",
    ]);
  });

  it("excludes years of experience from skills", async () => {
    const { database } = stubFor(visibleTarget);

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(profile?.skills[0]).toEqual({
      slug: "typescript",
      name: "TypeScript",
      category: "Programming Languages",
      proficiencyLevel: "EXPERT",
    });
    expect(JSON.stringify(profile)).not.toContain("yearsExperience");
    expect(JSON.stringify(profile)).not.toContain("9");
  });

  it.each([
    ["a user id", OWNER_ID],
    ["a profile id", "profile-row-id"],
    ["a skill id", "skill-row-id"],
    ["a name key", "open source"],
  ])("excludes %s from the payload", async (_label, forbidden) => {
    const { database } = stubFor(visibleTarget);

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(JSON.stringify(profile)).not.toContain(forbidden);
  });

  it("never includes auth fields, timestamps, or private preferences", async () => {
    const { database } = stubFor(visibleTarget);

    const serialized = JSON.stringify(
      await readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    );

    for (const forbidden of [
      "email",
      "emailVerified",
      "globalRole",
      "accountStatus",
      "onboardingCompletedAt",
      "timezone",
      "availabilityHoursPerWeek",
      "createdAt",
      "updatedAt",
      "nameKey",
      "session",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("returns the same safe projection to the owner as to any other viewer", async () => {
    const { database: ownerDb } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });
    const { database: memberDb } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    const asOwner = await readVisibleProfile(
      OWNER_ID,
      member(OWNER_ID),
      ownerDb,
    );
    const asOther = await readVisibleProfile(
      OWNER_ID,
      member(OTHER_ID),
      memberDb,
    );

    // The owner sees the public projection here, not their full private record.
    expect(asOwner).toEqual({
      displayName: "Ada Lovelace",
      headline: "Countess and engineer",
      bio: "Writes notes about analytical engines.",
      avatarUrl: null,
      skills: [
        {
          slug: "typescript",
          name: "TypeScript",
          category: "Programming Languages",
          proficiencyLevel: "EXPERT",
        },
      ],
      interests: [{ slug: "open-source", name: "Open Source" }],
    });
    expect(asOther).toBeNull();
  });

  it("represents missing optional data as null rather than a placeholder", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      headline: null,
      bio: null,
      avatarUrl: null,
      skills: [],
      interests: [],
    });

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(profile).toEqual({
      displayName: "Ada Lovelace",
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
    const { database } = stubFor({
      ...visibleTarget,
      skills: [
        {
          slug: "unity",
          name: "Unity",
          category: null,
          proficiencyLevel: "BEGINNER",
        },
        {
          slug: "css",
          name: "CSS",
          category: "Frontend",
          proficiencyLevel: "ADVANCED",
        },
        {
          slug: "react",
          name: "React",
          category: "Frontend",
          proficiencyLevel: "EXPERT",
        },
        {
          slug: "python",
          name: "Python",
          category: "Backend",
          proficiencyLevel: "INTERMEDIATE",
        },
      ],
    });

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(profile?.skills.map((skill) => skill.name)).toEqual([
      "Python",
      "CSS",
      "React",
      "Unity",
    ]);
  });

  it("orders interests by name", async () => {
    const { database } = stubFor({
      ...visibleTarget,
      interests: [
        { slug: "robotics", name: "Robotics" },
        { slug: "data-science", name: "Data Science" },
        { slug: "open-source", name: "Open Source" },
      ],
    });

    const profile = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

    expect(profile?.interests.map((interest) => interest.name)).toEqual([
      "Data Science",
      "Open Source",
      "Robotics",
    ]);
  });
});

describe("viewer context cannot grant extra privilege", () => {
  it("treats an anonymous viewer as the weakest tier for every visibility", async () => {
    for (const profileVisibility of [
      "PRIVATE",
      "MEMBERS_ONLY",
      "PUBLIC",
    ] as const) {
      const { database } = stubFor({ ...visibleTarget, profileVisibility });

      const result = await readVisibleProfile(OWNER_ID, ANONYMOUS, database);

      expect(result !== null, profileVisibility).toBe(
        profileVisibility === "PUBLIC",
      );
    }
  });

  it("does not let a non-owner reach a PRIVATE profile by changing the route", async () => {
    // PRIVATE is the only visibility where owner status is observable, so this is
    // the case that actually exercises owner detection. MEMBERS_ONLY is
    // deliberately not used here: any eligible member may see it by policy, so
    // denying that viewer would be a bug rather than a protection.
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "PRIVATE",
    });

    // The owner sees their own PRIVATE profile through the route locator.
    await expect(
      readVisibleProfile(OWNER_ID, member(OWNER_ID), database),
    ).resolves.not.toBeNull();

    // Another ACTIVE + verified user pointing the route at that id is refused.
    await expect(
      readVisibleProfile(OWNER_ID, member(OTHER_ID), database),
    ).resolves.toBeNull();

    // A near-miss id is not treated as the owner either.
    await expect(
      readVisibleProfile(OWNER_ID, member(`${OWNER_ID} `), database),
    ).resolves.toBeNull();

    // An anonymous viewer is refused for the same target.
    await expect(
      readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    ).resolves.toBeNull();
  });

  it("keeps MEMBERS_ONLY open to an eligible non-owner member", async () => {
    // Guards the policy itself, so a later "fix" to the IDOR test cannot quietly
    // narrow MEMBERS_ONLY and lock out ordinary members.
    const { database } = stubFor({
      ...visibleTarget,
      profileVisibility: "MEMBERS_ONLY",
    });

    await expect(
      readVisibleProfile(OWNER_ID, member(OTHER_ID), database),
    ).resolves.not.toBeNull();
    await expect(
      readVisibleProfile(OWNER_ID, member(OWNER_ID), database),
    ).resolves.not.toBeNull();
    await expect(
      readVisibleProfile(OWNER_ID, ANONYMOUS, database),
    ).resolves.toBeNull();
  });
});
