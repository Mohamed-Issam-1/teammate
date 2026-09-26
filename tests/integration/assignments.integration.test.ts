import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase, testPrisma } from "./fixtures";
import {
  addOwnInterest,
  listOwnInterestAssignments,
  listOwnSkillAssignments,
  removeOwnInterest,
  removeOwnSkillAssignment,
  saveOwnSkillAssignment,
  AssignmentNotOnboardedError,
  InvalidAssignmentInputError,
  TaxonomyEntryUnavailableError,
} from "../../src/server/profiles/assignments";
import { seedStarterTaxonomy } from "../../src/server/taxonomy/seed-taxonomy";
import {
  starterInterests,
  starterSkills,
} from "../../src/server/taxonomy/starter-taxonomy";

/**
 * Own skill/interest assignment writes against real PostgreSQL, on the guarded
 * `teammate_test` database only.
 *
 * Every write goes through the session-scoped boundary, which derives the user
 * from the session argument. There is no way to pass a user id, which is what
 * makes cross-user assignment structurally impossible rather than merely
 * unauthorized.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${Date.now().toString(36).slice(-6)}`;
}

type SeededUser = {
  id: string;
  session: {
    user: { id: string; accountStatus: string; emailVerified: boolean };
  } | null;
};

async function seedUser(
  options: {
    verified?: boolean;
    status?: string;
    onboarded?: boolean;
  } = {},
): Promise<SeededUser> {
  const suffix = uniqueSuffix();
  const id = `user-${suffix}`;
  const status = options.status ?? "ACTIVE";
  const verified = options.verified ?? true;

  await testPrisma.user.create({
    data: {
      id,
      name: `Assign ${suffix}`,
      email: `assign-${suffix}@teammate-test.example`,
      emailVerified: verified,
      accountStatus: status,
    },
  });

  if (options.onboarded ?? true) {
    await testPrisma.profile.create({
      data: {
        userId: id,
        displayName: `Assign ${suffix}`,
        onboardingCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }

  return {
    id,
    session: { user: { id, accountStatus: status, emailVerified: verified } },
  };
}

async function seedTaxonomy() {
  await seedStarterTaxonomy(testPrisma);
}

function skillId(slug: string): Promise<string> {
  return testPrisma.skill
    .findUniqueOrThrow({ where: { slug } })
    .then((row) => row.id);
}

function interestId(slug: string): Promise<string> {
  return testPrisma.interest
    .findUniqueOrThrow({ where: { slug } })
    .then((row) => row.id);
}

/** A well-formed UUID that is guaranteed not to exist as taxonomy. */
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

/** Optional categories compare with null last, matching the boundary. */
function compareCategory(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a.localeCompare(b);
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

describe("own skill assignments", () => {
  it("lets an active verified onboarded user add a skill", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    const saved = await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
      testPrisma,
    );

    expect(saved).toMatchObject({
      slug: "react",
      name: "React",
      category: "Frontend",
      proficiencyLevel: "ADVANCED",
      yearsExperience: null,
      updated: false,
    });

    const rows = await listOwnSkillAssignments(user.session, testPrisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skillId: react,
      slug: "react",
      name: "React",
      proficiencyLevel: "ADVANCED",
      yearsExperience: null,
    });
  });

  it("persists the proficiency level", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    for (const proficiencyLevel of [
      "BEGINNER",
      "INTERMEDIATE",
      "ADVANCED",
      "EXPERT",
    ]) {
      await saveOwnSkillAssignment(
        user.session,
        { skillId: react, proficiencyLevel, yearsExperience: null },
        testPrisma,
      );

      const [row] = await listOwnSkillAssignments(user.session, testPrisma);
      expect(row?.proficiencyLevel).toBe(proficiencyLevel);
    }
  });

  it.each([
    ["empty input", "", null],
    ["zero", 0, 0],
    ["the maximum", 100, 100],
    ["a mid value", 42, 42],
  ])("persists %s years of experience", async (_label, input, expected) => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "BEGINNER", yearsExperience: input },
      testPrisma,
    );

    const [row] = await listOwnSkillAssignments(user.session, testPrisma);
    expect(row?.yearsExperience).toBe(expected);
  });

  it.each([
    ["negative", -1],
    ["above the maximum", 101],
    ["a fraction", 2.5],
    ["exponent notation string", "1e2"],
    ["hex string", "0x10"],
    ["arbitrary text", "many"],
    ["a huge JSON number", 1e21],
  ])("rejects %s years of experience", async (_label, yearsExperience) => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await expect(
      saveOwnSkillAssignment(
        user.session,
        { skillId: react, proficiencyLevel: "BEGINNER", yearsExperience },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    expect(await testPrisma.userSkill.count()).toBe(0);
  });

  it("rejects an invalid proficiency level", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await expect(
      saveOwnSkillAssignment(
        user.session,
        { skillId: react, proficiencyLevel: "MASTER", yearsExperience: null },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    expect(await testPrisma.userSkill.count()).toBe(0);
  });

  it("updates the existing assignment when the same skill is saved again", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "BEGINNER", yearsExperience: 0 },
      testPrisma,
    );
    const updated = await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "EXPERT", yearsExperience: 12 },
      testPrisma,
    );

    expect(updated.updated).toBe(true);

    const rows = await listOwnSkillAssignments(user.session, testPrisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      proficiencyLevel: "EXPERT",
      yearsExperience: 12,
    });
  });

  it("never creates a duplicate row for a repeated save", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: 5 },
      testPrisma,
    );
    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: 5 },
      testPrisma,
    );
    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "INTERMEDIATE", yearsExperience: 6 },
      testPrisma,
    );

    expect(await testPrisma.userSkill.count()).toBe(1);
  });

  it("leaves exactly one assignment after concurrent saves", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await Promise.allSettled(
      Array.from({ length: 5 }, (_unused, index) =>
        saveOwnSkillAssignment(
          user.session,
          {
            skillId: react,
            proficiencyLevel: index % 2 === 0 ? "ADVANCED" : "EXPERT",
            yearsExperience: index,
          },
          testPrisma,
        ),
      ),
    );

    const rows = await testPrisma.userSkill.findMany({
      where: { userId: user.id, skillId: react },
    });

    expect(rows).toHaveLength(1);
    expect(["ADVANCED", "EXPERT"]).toContain(rows[0]?.proficiencyLevel);
  });

  it("rejects a well-formed but unknown skill id", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    await expect(
      saveOwnSkillAssignment(
        user.session,
        {
          skillId: MISSING_ID,
          proficiencyLevel: "ADVANCED",
          yearsExperience: null,
        },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(TaxonomyEntryUnavailableError);

    expect(await testPrisma.userSkill.count()).toBe(0);
  });

  it.each([
    ["a slug", "react"],
    ["a truncated uuid", "3f2504e0-4f89-41d3"],
    ["plain text", "not-a-uuid"],
  ])(
    "rejects %s before reaching the database",
    async (_label, skillIdValue) => {
      const user = await seedUser();
      await seedTaxonomy();

      await expect(
        saveOwnSkillAssignment(
          user.session,
          {
            skillId: skillIdValue,
            proficiencyLevel: "ADVANCED",
            yearsExperience: null,
          },
          testPrisma,
        ),
      ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

      expect(await testPrisma.userSkill.count()).toBe(0);
    },
  );

  it("ignores a client-supplied userId and assigns to the session user", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await expect(
      saveOwnSkillAssignment(
        owner.session,
        {
          skillId: react,
          proficiencyLevel: "ADVANCED",
          yearsExperience: null,
          userId: other.id,
        },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    const rows = await testPrisma.userSkill.findMany();
    expect(rows).toHaveLength(0);
  });

  it("keeps each user's assignment independent", async () => {
    const first = await seedUser();
    const second = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");
    const postgres = await skillId("postgresql");

    await saveOwnSkillAssignment(
      first.session,
      { skillId: react, proficiencyLevel: "EXPERT", yearsExperience: 9 },
      testPrisma,
    );
    await saveOwnSkillAssignment(
      second.session,
      { skillId: postgres, proficiencyLevel: "BEGINNER", yearsExperience: 1 },
      testPrisma,
    );

    const firstRows = await listOwnSkillAssignments(first.session, testPrisma);
    const secondRows = await listOwnSkillAssignments(
      second.session,
      testPrisma,
    );

    expect(firstRows.map((row) => row.slug)).toEqual(["react"]);
    expect(secondRows.map((row) => row.slug)).toEqual(["postgresql"]);
  });

  it("removes the caller's own skill assignment", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
      testPrisma,
    );
    await removeOwnSkillAssignment(
      user.session,
      { skillId: react },
      testPrisma,
    );

    expect(await listOwnSkillAssignments(user.session, testPrisma)).toEqual([]);
    expect(await testPrisma.userSkill.count()).toBe(0);
  });

  it("treats removing an absent own assignment as success", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await expect(
      removeOwnSkillAssignment(user.session, { skillId: react }, testPrisma),
    ).resolves.toEqual({ skillId: react });
    await expect(
      removeOwnSkillAssignment(user.session, { skillId: react }, testPrisma),
    ).resolves.toEqual({ skillId: react });
  });

  it("does not delete the skill taxonomy row on removal", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
      testPrisma,
    );
    await removeOwnSkillAssignment(
      user.session,
      { skillId: react },
      testPrisma,
    );

    expect(await testPrisma.skill.count()).toBe(starterSkills.length);
    expect(
      await testPrisma.skill.findUnique({ where: { id: react } }),
    ).not.toBeNull();
  });

  it("does not remove another user's assignment", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      owner.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
      testPrisma,
    );
    await removeOwnSkillAssignment(
      other.session,
      { skillId: react },
      testPrisma,
    );

    expect(await testPrisma.userSkill.count()).toBe(1);
    expect(
      await testPrisma.userSkill.findFirst({ where: { userId: owner.id } }),
    ).not.toBeNull();
  });

  it("rejects a removal payload carrying a userId", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      owner.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
      testPrisma,
    );

    await expect(
      removeOwnSkillAssignment(
        other.session,
        { skillId: react, userId: owner.id },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    expect(await testPrisma.userSkill.count()).toBe(1);
  });

  it("orders assignments by category then name", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    for (const slug of ["typescript", "react", "postgresql"]) {
      await saveOwnSkillAssignment(
        user.session,
        {
          skillId: await skillId(slug),
          proficiencyLevel: "ADVANCED",
          yearsExperience: null,
        },
        testPrisma,
      );
    }

    const rows = await listOwnSkillAssignments(user.session, testPrisma);
    const expected = [...rows].sort((a, b) => {
      const byCategory = compareCategory(a.category, b.category);
      return byCategory === 0 ? a.name.localeCompare(b.name) : byCategory;
    });

    expect(rows.map((row) => row.skillId)).toEqual(
      expected.map((row) => row.skillId),
    );
    expect(rows.map((row) => row.slug)).toEqual([
      "postgresql",
      "react",
      "typescript",
    ]);
  });

  it("sorts an uncategorized assignment last, matching the taxonomy read order", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    const uncategorized = await testPrisma.skill.create({
      data: {
        slug: `uncategorized-${uniqueSuffix()}`,
        name: "Zzz Uncategorized",
        nameKey: "zzz uncategorized",
        category: null,
      },
    });

    for (const id of [await skillId("react"), uncategorized.id]) {
      await saveOwnSkillAssignment(
        user.session,
        { skillId: id, proficiencyLevel: "ADVANCED", yearsExperience: null },
        testPrisma,
      );
    }

    const rows = await listOwnSkillAssignments(user.session, testPrisma);

    // Categorized first, uncategorized last.
    expect(rows.map((row) => row.skillId)).toEqual([
      await skillId("react"),
      uncategorized.id,
    ]);
    expect(rows.map((row) => row.category)).toEqual(["Frontend", null]);
  });

  it("projects only the approved assignment fields", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: 3 },
      testPrisma,
    );

    const [row] = await listOwnSkillAssignments(user.session, testPrisma);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "category",
      "name",
      "proficiencyLevel",
      "skillId",
      "slug",
      "yearsExperience",
    ]);
    expect(row).not.toHaveProperty("nameKey");
    expect(row).not.toHaveProperty("userId");
  });
});

/* -------------------------------------------------------------------------- */
/* Interests                                                                   */
/* -------------------------------------------------------------------------- */

describe("own interest assignments", () => {
  it("lets an active verified onboarded user add an interest", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    const added = await addOwnInterest(
      user.session,
      { interestId: openSource },
      testPrisma,
    );

    expect(added).toEqual({
      interestId: openSource,
      slug: "open-source",
      name: "Open Source",
    });

    const rows = await listOwnInterestAssignments(user.session, testPrisma);
    expect(rows).toEqual([
      { interestId: openSource, slug: "open-source", name: "Open Source" },
    ]);
  });

  it("is idempotent when an interest is added twice", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);
    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);
    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);

    expect(await testPrisma.userInterest.count()).toBe(1);
    expect(
      await listOwnInterestAssignments(user.session, testPrisma),
    ).toHaveLength(1);
  });

  it("leaves exactly one assignment after concurrent adds", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        addOwnInterest(user.session, { interestId: openSource }, testPrisma),
      ),
    );

    expect(await testPrisma.userInterest.count()).toBe(1);
  });

  it("rejects a well-formed but unknown interest id", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    await expect(
      addOwnInterest(user.session, { interestId: MISSING_ID }, testPrisma),
    ).rejects.toBeInstanceOf(TaxonomyEntryUnavailableError);

    expect(await testPrisma.userInterest.count()).toBe(0);
  });

  it.each([
    ["a slug", "open-source"],
    ["a truncated uuid", "9c858901-8a57-4791"],
    ["plain text", "not-a-uuid"],
  ])("rejects %s before reaching the database", async (_label, value) => {
    const user = await seedUser();
    await seedTaxonomy();

    await expect(
      addOwnInterest(user.session, { interestId: value }, testPrisma),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    expect(await testPrisma.userInterest.count()).toBe(0);
  });

  it("ignores a client-supplied userId", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await expect(
      addOwnInterest(
        owner.session,
        { interestId: openSource, userId: other.id },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    expect(await testPrisma.userInterest.count()).toBe(0);
  });

  it("removes the caller's own interest assignment", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);
    await removeOwnInterest(
      user.session,
      { interestId: openSource },
      testPrisma,
    );

    expect(await listOwnInterestAssignments(user.session, testPrisma)).toEqual(
      [],
    );
  });

  it("treats removing an absent own assignment as success", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await expect(
      removeOwnInterest(user.session, { interestId: openSource }, testPrisma),
    ).resolves.toEqual({ interestId: openSource });
  });

  it("does not delete the interest taxonomy row on removal", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);
    await removeOwnInterest(
      user.session,
      { interestId: openSource },
      testPrisma,
    );

    expect(await testPrisma.interest.count()).toBe(starterInterests.length);
    expect(
      await testPrisma.interest.findUnique({ where: { id: openSource } }),
    ).not.toBeNull();
  });

  it("does not remove another user's assignment", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await addOwnInterest(owner.session, { interestId: openSource }, testPrisma);
    await removeOwnInterest(
      other.session,
      { interestId: openSource },
      testPrisma,
    );

    expect(await testPrisma.userInterest.count()).toBe(1);
  });

  it("orders assignments by name", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    for (const slug of [
      "open-source",
      "artificial-intelligence",
      "data-science",
    ]) {
      await addOwnInterest(
        user.session,
        { interestId: await interestId(slug) },
        testPrisma,
      );
    }

    const names = (
      await listOwnInterestAssignments(user.session, testPrisma)
    ).map((row) => row.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("projects only the approved interest fields", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const openSource = await interestId("open-source");

    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);

    const [row] = await listOwnInterestAssignments(user.session, testPrisma);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "interestId",
      "name",
      "slug",
    ]);
    expect(row).not.toHaveProperty("nameKey");
    expect(row).not.toHaveProperty("userId");
  });
});

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

describe("assignment authorization", () => {
  it.each([
    ["save skill", "saveOwnSkillAssignment"],
    ["remove skill", "removeOwnSkillAssignment"],
    ["add interest", "addOwnInterest"],
    ["remove interest", "removeOwnInterest"],
  ] as const)(
    "rejects an unauthenticated caller for %s",
    async (_label, fn) => {
      const user = await seedUser();
      await seedTaxonomy();
      const react = await skillId("react");
      const openSource = await interestId("open-source");

      const input =
        fn === "saveOwnSkillAssignment"
          ? {
              skillId: react,
              proficiencyLevel: "ADVANCED",
              yearsExperience: null,
            }
          : fn === "removeOwnSkillAssignment"
            ? { skillId: react }
            : fn === "addOwnInterest"
              ? { interestId: openSource }
              : { interestId: openSource };

      const call = {
        saveOwnSkillAssignment,
        removeOwnSkillAssignment,
        addOwnInterest,
        removeOwnInterest,
      }[fn];

      await expect(call(null, input, testPrisma)).rejects.toThrowError(
        "Authentication required",
      );
      expect(await testPrisma.userSkill.count()).toBe(0);
      expect(await testPrisma.userInterest.count()).toBe(0);
      expect(user.id).toBeTruthy();
    },
  );

  it("rejects an unverified caller", async () => {
    const user = await seedUser({ verified: false });
    await seedTaxonomy();
    const react = await skillId("react");

    await expect(
      saveOwnSkillAssignment(
        user.session,
        { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
        testPrisma,
      ),
    ).rejects.toThrowError("Email verification required");

    expect(await testPrisma.userSkill.count()).toBe(0);
  });

  it.each(["SUSPENDED", "PENDING", "BANNED"])(
    "rejects a %s caller",
    async (accountStatus) => {
      const user = await seedUser({ status: accountStatus });
      await seedTaxonomy();
      const react = await skillId("react");

      await expect(
        saveOwnSkillAssignment(
          user.session,
          {
            skillId: react,
            proficiencyLevel: "ADVANCED",
            yearsExperience: null,
          },
          testPrisma,
        ),
      ).rejects.toThrowError("Authentication required");

      expect(await testPrisma.userSkill.count()).toBe(0);
    },
  );

  it("rejects a write when onboarding is not complete", async () => {
    const user = await seedUser({ onboarded: false });
    await seedTaxonomy();
    const react = await skillId("react");
    const openSource = await interestId("open-source");

    await expect(
      saveOwnSkillAssignment(
        user.session,
        { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: null },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);

    await expect(
      addOwnInterest(user.session, { interestId: openSource }, testPrisma),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);

    await expect(
      removeOwnSkillAssignment(user.session, { skillId: react }, testPrisma),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);

    await expect(
      removeOwnInterest(user.session, { interestId: openSource }, testPrisma),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);

    expect(await testPrisma.userSkill.count()).toBe(0);
    expect(await testPrisma.userInterest.count()).toBe(0);
  });

  it("rejects a read when onboarding is not complete", async () => {
    const user = await seedUser({ onboarded: false });

    await expect(
      listOwnSkillAssignments(user.session, testPrisma),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);
    await expect(
      listOwnInterestAssignments(user.session, testPrisma),
    ).rejects.toBeInstanceOf(AssignmentNotOnboardedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Taxonomy immutability and mass assignment                                   */
/* -------------------------------------------------------------------------- */

describe("taxonomy immutability under assignment writes", () => {
  it("never alters taxonomy rows when saving, updating, or removing", async () => {
    const user = await seedUser();
    await seedTaxonomy();

    const before = await testPrisma.skill.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        nameKey: true,
        category: true,
      },
      orderBy: { slug: "asc" },
    });
    const interestsBefore = await testPrisma.interest.findMany({
      select: { id: true, slug: true, name: true, nameKey: true },
      orderBy: { slug: "asc" },
    });

    const react = await skillId("react");
    const openSource = await interestId("open-source");

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "ADVANCED", yearsExperience: 4 },
      testPrisma,
    );
    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "EXPERT", yearsExperience: 8 },
      testPrisma,
    );
    await addOwnInterest(user.session, { interestId: openSource }, testPrisma);
    await removeOwnSkillAssignment(
      user.session,
      { skillId: react },
      testPrisma,
    );
    await removeOwnInterest(
      user.session,
      { interestId: openSource },
      testPrisma,
    );

    const after = await testPrisma.skill.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        nameKey: true,
        category: true,
      },
      orderBy: { slug: "asc" },
    });
    const interestsAfter = await testPrisma.interest.findMany({
      select: { id: true, slug: true, name: true, nameKey: true },
      orderBy: { slug: "asc" },
    });

    expect(after).toEqual(before);
    expect(interestsAfter).toEqual(interestsBefore);
  });

  it("rejects taxonomy fields smuggled into an assignment payload", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");
    const openSource = await interestId("open-source");

    const before = await testPrisma.skill.findUniqueOrThrow({
      where: { id: react },
    });

    for (const extra of [
      { name: "Renamed" },
      { slug: "renamed" },
      { nameKey: "renamed" },
      { category: "Renamed" },
      { globalRole: "ADMIN" },
      { accountStatus: "ACTIVE" },
      { onboardingCompletedAt: new Date().toISOString() },
    ]) {
      await expect(
        saveOwnSkillAssignment(
          user.session,
          {
            skillId: react,
            proficiencyLevel: "ADVANCED",
            yearsExperience: null,
            ...extra,
          },
          testPrisma,
        ),
      ).rejects.toBeInstanceOf(InvalidAssignmentInputError);
    }

    await expect(
      addOwnInterest(
        user.session,
        { interestId: openSource, name: "Renamed", slug: "renamed" },
        testPrisma,
      ),
    ).rejects.toBeInstanceOf(InvalidAssignmentInputError);

    const after = await testPrisma.skill.findUniqueOrThrow({
      where: { id: react },
    });
    expect(after).toEqual(before);
    expect(await testPrisma.userSkill.count()).toBe(0);
    expect(await testPrisma.userInterest.count()).toBe(0);
  });

  it("leaves the user's auth fields untouched by an assignment write", async () => {
    const user = await seedUser();
    await seedTaxonomy();
    const react = await skillId("react");

    const before = await testPrisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    await saveOwnSkillAssignment(
      user.session,
      { skillId: react, proficiencyLevel: "EXPERT", yearsExperience: 10 },
      testPrisma,
    );

    const after = await testPrisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const profileAfter = await testPrisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });

    expect(after.accountStatus).toBe(before.accountStatus);
    expect(after.emailVerified).toBe(before.emailVerified);
    expect(after.name).toBe(before.name);
    expect(after.email).toBe(before.email);
    expect(profileAfter.onboardingCompletedAt).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
  });

  it("reports an empty assignment list when taxonomy is unseeded", async () => {
    const user = await seedUser();

    await expect(
      listOwnSkillAssignments(user.session, testPrisma),
    ).resolves.toEqual([]);
    await expect(
      listOwnInterestAssignments(user.session, testPrisma),
    ).resolves.toEqual([]);
  });
});
