import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase, testPrisma } from "./fixtures";

/**
 * Phase 2 database-constraint tests.
 *
 * These assert what the database actually enforces against real PostgreSQL.
 * They deliberately do NOT assert any runtime normalization: the database only
 * knows the stored `nameKey` column. A "React" / "react" collision is enforced
 * only when both writes carry the same `nameKey`, which is the future
 * server-side normalization contract's responsibility, not the database's.
 *
 * Taxonomy rows created here are test fixtures, not product seed data.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${randomUUID().slice(0, 8)}`;
}

async function createUser(prefix = "phase2") {
  const suffix = uniqueSuffix();
  const email = `${prefix}-${suffix}@teammate-test.example`;

  return testPrisma.user.create({
    data: { id: `user-${suffix}`, name: `Phase Two ${suffix}`, email },
  });
}

type SkillInput = {
  slug?: string;
  name?: string;
  nameKey?: string;
  category?: string;
};

async function createSkill(input: SkillInput = {}) {
  const suffix = uniqueSuffix();
  const name = input.name ?? `Skill ${suffix}`;
  const nameKey = input.nameKey ?? name.toLowerCase();

  return testPrisma.skill.create({
    data: {
      slug: input.slug ?? `skill-${suffix}`,
      name,
      nameKey,
      ...(input.category === undefined ? {} : { category: input.category }),
    },
  });
}

async function createInterest(input: { nameKey?: string; name?: string } = {}) {
  const suffix = uniqueSuffix();
  const name = input.name ?? `Interest ${suffix}`;
  const nameKey = input.nameKey ?? name.toLowerCase();

  return testPrisma.interest.create({
    data: { slug: `interest-${suffix}`, name, nameKey },
  });
}

/** A unique-constraint violation, whatever PostgreSQL reports it as. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** A foreign-key violation. */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2003"
  );
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("Phase 2 Profile migration compatibility", () => {
  it("keeps a Phase 1-style profile valid and defaults visibility to PRIVATE", async () => {
    const user = await createUser("profile-compat");

    // Exactly the Phase 1 write shape: only the original required columns.
    const profile = await testPrisma.profile.create({
      data: { userId: user.id, displayName: "Phase One Survivor" },
    });

    expect(profile.profileVisibility).toBe("PRIVATE");
    expect(profile.headline).toBeNull();
    expect(profile.bio).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(profile.availabilityHoursPerWeek).toBeNull();
    expect(profile.timezone).toBeNull();
    expect(profile.onboardingCompletedAt).toBeNull();
    expect(profile.createdAt).toBeInstanceOf(Date);
    expect(profile.updatedAt).toBeInstanceOf(Date);
  });

  it("does not change the meaning of onboarding completion", async () => {
    const user = await createUser("onboarding-semantics");
    const completedAt = new Date("2026-01-15T10:00:00.000Z");

    const profile = await testPrisma.profile.create({
      data: {
        userId: user.id,
        displayName: "Completed User",
        onboardingCompletedAt: completedAt,
      },
    });

    expect(profile.onboardingCompletedAt).toEqual(completedAt);
    expect(profile.profileVisibility).toBe("PRIVATE");
  });

  it("persists every optional profile field and all visibility values", async () => {
    const user = await createUser("profile-fields");

    const profile = await testPrisma.profile.create({
      data: {
        userId: user.id,
        displayName: "Fully Populated",
        headline: "Backend engineer",
        bio: "A bio.",
        avatarUrl: "https://cdn.example/avatar.png",
        availabilityHoursPerWeek: 12,
        timezone: "Europe/Cairo",
        profileVisibility: "MEMBERS_ONLY",
      },
    });

    expect(profile).toMatchObject({
      headline: "Backend engineer",
      bio: "A bio.",
      avatarUrl: "https://cdn.example/avatar.png",
      availabilityHoursPerWeek: 12,
      timezone: "Europe/Cairo",
      profileVisibility: "MEMBERS_ONLY",
    });
  });
});

describe("Skill uniqueness constraints", () => {
  it("rejects a duplicate slug", async () => {
    const skill = await createSkill({ slug: "duplicate-slug-probe" });

    const error = await testPrisma.skill
      .create({
        data: {
          slug: skill.slug,
          name: `Different ${uniqueSuffix()}`,
          nameKey: `different-${uniqueSuffix()}`,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects a duplicate exact name", async () => {
    const skill = await createSkill({ name: "Duplicate Name Probe" });

    const error = await testPrisma.skill
      .create({
        data: {
          slug: `distinct-${uniqueSuffix()}`,
          name: skill.name,
          nameKey: `distinct-${uniqueSuffix()}`,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects a duplicate nameKey even when the display name differs in case", async () => {
    // The database stores whatever it is given. A "React" / "react" collision is
    // only caught here because both rows carry the identical nameKey.
    const skill = await createSkill({
      name: "React",
      nameKey: "react",
      slug: "react-probe",
    });

    const error = await testPrisma.skill
      .create({
        data: {
          slug: `react-alt-${uniqueSuffix()}`,
          name: "react",
          nameKey: "react",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
    expect(skill.nameKey).toBe("react");
  });

  it("does not merge distinct names that merely share a slug-free key space", async () => {
    // "React.js" is a genuinely different entry and must not collide with
    // "react". No fuzzy or confusable matching exists at the database layer.
    await createSkill({ name: "React", nameKey: "react", slug: "react" });
    const distinct = await createSkill({
      name: "React.js",
      nameKey: "react.js",
      slug: "react-js",
    });

    expect(distinct.name).toBe("React.js");
    expect(await testPrisma.skill.count()).toBe(2);
  });

  it("generates an id without an explicit value", async () => {
    const skill = await createSkill();

    expect(skill.id).toEqual(expect.any(String));
    expect(skill.id.length).toBeGreaterThan(0);
  });

  it("allows a null category", async () => {
    const skill = await createSkill({ category: undefined });

    expect(skill.category).toBeNull();
  });
});

describe("Interest uniqueness constraints", () => {
  it("rejects a duplicate slug", async () => {
    const interest = await createInterest();

    const error = await testPrisma.interest
      .create({
        data: {
          slug: interest.slug,
          name: `Other ${uniqueSuffix()}`,
          nameKey: `other-${uniqueSuffix()}`,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects a duplicate nameKey", async () => {
    await createInterest({ name: "Open Source", nameKey: "open source" });

    const error = await testPrisma.interest
      .create({
        data: {
          slug: `other-${uniqueSuffix()}`,
          name: "open source",
          nameKey: "open source",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("permits two interests that share a display name only by coincidence of key", async () => {
    const first = await createInterest({ name: "Design", nameKey: "design" });
    const second = await createInterest({
      name: "Design Systems",
      nameKey: "design systems",
    });

    expect(first.id).not.toBe(second.id);
  });
});

describe("UserSkill constraints", () => {
  it("accepts a valid assignment and persists the enum value", async () => {
    const user = await createUser("userskill-valid");
    const skill = await createSkill();

    const assignment = await testPrisma.userSkill.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        proficiencyLevel: "ADVANCED",
      },
    });

    expect(assignment.proficiencyLevel).toBe("ADVANCED");
    expect(assignment.yearsExperience).toBeNull();
  });

  it("persists every proficiency level and an optional years value", async () => {
    const user = await createUser("userskill-enum");

    for (const level of [
      "BEGINNER",
      "INTERMEDIATE",
      "ADVANCED",
      "EXPERT",
    ] as const) {
      const skill = await createSkill();
      const assignment = await testPrisma.userSkill.create({
        data: {
          userId: user.id,
          skillId: skill.id,
          proficiencyLevel: level,
          yearsExperience: 3,
        },
      });

      expect(assignment.proficiencyLevel).toBe(level);
    }
  });

  it("rejects a duplicate userId and skillId pair", async () => {
    const user = await createUser("userskill-dupe");
    const skill = await createSkill();

    await testPrisma.userSkill.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        proficiencyLevel: "BEGINNER",
      },
    });

    const error = await testPrisma.userSkill
      .create({
        data: {
          userId: user.id,
          skillId: skill.id,
          proficiencyLevel: "EXPERT",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects an unknown user foreign key", async () => {
    const skill = await createSkill();

    const error = await testPrisma.userSkill
      .create({
        data: {
          userId: "user-does-not-exist",
          skillId: skill.id,
          proficiencyLevel: "BEGINNER",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("rejects an unknown skill foreign key", async () => {
    const user = await createUser("userskill-missing-skill");

    const error = await testPrisma.userSkill
      .create({
        data: {
          userId: user.id,
          skillId: "00000000-0000-4000-8000-000000000000",
          proficiencyLevel: "BEGINNER",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });
});

describe("UserInterest constraints", () => {
  it("accepts a valid assignment", async () => {
    const user = await createUser("userinterest-valid");
    const interest = await createInterest();

    const assignment = await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: interest.id },
    });

    expect(assignment.interestId).toBe(interest.id);
  });

  it("rejects a duplicate userId and interestId pair", async () => {
    const user = await createUser("userinterest-dupe");
    const interest = await createInterest();

    await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: interest.id },
    });

    const error = await testPrisma.userInterest
      .create({ data: { userId: user.id, interestId: interest.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects an unknown user foreign key", async () => {
    const interest = await createInterest();

    const error = await testPrisma.userInterest
      .create({ data: { userId: "user-missing", interestId: interest.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("rejects an unknown interest foreign key", async () => {
    const user = await createUser("userinterest-missing");

    const error = await testPrisma.userInterest
      .create({
        data: {
          userId: user.id,
          interestId: "00000000-0000-4000-8000-000000000000",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });
});

describe("referential actions", () => {
  it("cascades join rows when the user is deleted", async () => {
    const user = await createUser("cascade-user");
    const skill = await createSkill();
    const interest = await createInterest();

    await testPrisma.userSkill.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        proficiencyLevel: "BEGINNER",
      },
    });
    await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: interest.id },
    });
    await testPrisma.profile.create({
      data: { userId: user.id, displayName: "Cascade Subject" },
    });

    await testPrisma.user.delete({ where: { id: user.id } });

    expect(await testPrisma.userSkill.count()).toBe(0);
    expect(await testPrisma.userInterest.count()).toBe(0);
    expect(await testPrisma.profile.count()).toBe(0);
  });

  it("never deletes shared taxonomy when a user is deleted", async () => {
    const user = await createUser("taxonomy-survival");
    const skill = await createSkill();
    const interest = await createInterest();

    await testPrisma.userSkill.create({
      data: { userId: user.id, skillId: skill.id, proficiencyLevel: "EXPERT" },
    });
    await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: interest.id },
    });

    await testPrisma.user.delete({ where: { id: user.id } });

    expect(await testPrisma.skill.count()).toBe(1);
    expect(await testPrisma.interest.count()).toBe(1);
    expect(
      (await testPrisma.skill.findUnique({ where: { id: skill.id } }))?.id,
    ).toBe(skill.id);
    expect(
      (await testPrisma.interest.findUnique({ where: { id: interest.id } }))
        ?.id,
    ).toBe(interest.id);
  });

  it("restricts deleting a skill that is still referenced", async () => {
    const user = await createUser("restrict-skill");
    const skill = await createSkill();

    await testPrisma.userSkill.create({
      data: {
        userId: user.id,
        skillId: skill.id,
        proficiencyLevel: "BEGINNER",
      },
    });

    const error = await testPrisma.skill
      .delete({ where: { id: skill.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeDefined();
    expect(await testPrisma.skill.count()).toBe(1);
  });

  it("restricts deleting an interest that is still referenced", async () => {
    const user = await createUser("restrict-interest");
    const interest = await createInterest();

    await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: interest.id },
    });

    const error = await testPrisma.interest
      .delete({ where: { id: interest.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeDefined();
    expect(await testPrisma.interest.count()).toBe(1);
  });

  it("allows deleting unreferenced taxonomy", async () => {
    const skill = await createSkill();
    const interest = await createInterest();

    await testPrisma.skill.delete({ where: { id: skill.id } });
    await testPrisma.interest.delete({ where: { id: interest.id } });

    expect(await testPrisma.skill.count()).toBe(0);
    expect(await testPrisma.interest.count()).toBe(0);
  });
});

describe("generated identifiers", () => {
  it("produces distinct ids for many taxonomy rows written without one", async () => {
    const skills = await Promise.all([
      createSkill(),
      createSkill(),
      createSkill(),
    ]);

    const ids = new Set(skills.map((skill) => skill.id));

    expect(ids.size).toBe(3);
    expect(await testPrisma.skill.count()).toBe(3);
  });

  it("matches the UUID shape Prisma generates for the id default", async () => {
    const skill = await createSkill();

    expect(skill.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(skill.id).toHaveLength(36);
  });
});
