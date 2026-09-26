import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase, testPrisma } from "./fixtures";
import {
  listTaxonomyInterests,
  listTaxonomySkills,
} from "../../src/server/taxonomy/reads";
import {
  seedStarterTaxonomy,
  TaxonomyConflictError,
} from "../../src/server/taxonomy/seed-taxonomy";
import { toNameKey } from "../../src/server/taxonomy/normalize";
import {
  starterInterests,
  starterSkills,
} from "../../src/server/taxonomy/starter-taxonomy";

/**
 * Seed behavior and taxonomy reads against real PostgreSQL on the guarded
 * `teammate_test` database only. No product seed is ever run against the
 * development database from this suite.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${Date.now().toString(36).slice(-6)}`;
}

async function seedUser(options: { verified?: boolean; status?: string } = {}) {
  const suffix = uniqueSuffix();
  const id = `user-${suffix}`;

  await testPrisma.user.create({
    data: {
      id,
      name: `Taxonomy ${suffix}`,
      email: `tax-${suffix}@teammate-test.example`,
      emailVerified: options.verified ?? true,
      accountStatus: options.status ?? "ACTIVE",
    },
  });

  return {
    user: {
      user: {
        id,
        accountStatus: options.status ?? "ACTIVE",
        emailVerified: options.verified ?? true,
      },
    },
    id,
  };
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await resetTestDatabase();
  await testPrisma.$disconnect();
});

describe("starter taxonomy seeding", () => {
  it("inserts the expected rows on the first run", async () => {
    const result = await seedStarterTaxonomy(testPrisma);

    expect(result.skillsInserted).toBe(starterSkills.length);
    expect(result.interestsInserted).toBe(starterInterests.length);
    expect(result.totalSkills).toBe(starterSkills.length);
    expect(result.totalInterests).toBe(starterInterests.length);
  });

  it("persists canonical names, derived keys, and categories", async () => {
    await seedStarterTaxonomy(testPrisma);

    const react = await testPrisma.skill.findUniqueOrThrow({
      where: { slug: "react" },
    });

    expect(react.name).toBe("React");
    expect(react.nameKey).toBe(toNameKey("React"));
    expect(react.category).toBe("Frontend");

    const cpp = await testPrisma.skill.findUniqueOrThrow({
      where: { slug: "cpp" },
    });
    expect(cpp.name).toBe("C++");
    expect(cpp.nameKey).toBe("c++");

    const cloudDevops = await testPrisma.interest.findUniqueOrThrow({
      where: { slug: "cloud-devops" },
    });
    expect(cloudDevops.name).toBe("Cloud & DevOps");
    expect(cloudDevops.nameKey).toBe("cloud & devops");
  });

  it("is idempotent and does not double counts on a second run", async () => {
    const first = await seedStarterTaxonomy(testPrisma);
    const second = await seedStarterTaxonomy(testPrisma);
    const third = await seedStarterTaxonomy(testPrisma);

    expect(first.skillsInserted).toBe(starterSkills.length);
    expect(second.skillsInserted).toBe(0);
    expect(third.skillsInserted).toBe(0);
    expect(second.interestsInserted).toBe(0);

    expect(second.totalSkills).toBe(starterSkills.length);
    expect(second.totalInterests).toBe(starterInterests.length);
    expect(await testPrisma.skill.count()).toBe(starterSkills.length);
    expect(await testPrisma.interest.count()).toBe(starterInterests.length);
  });

  it("does not delete unrelated existing taxonomy rows", async () => {
    const customSlug = `custom-${uniqueSuffix()}`;
    await testPrisma.skill.create({
      data: {
        slug: customSlug,
        name: `Custom ${customSlug}`,
        nameKey: toNameKey(`Custom ${customSlug}`),
        category: "Other Technical",
      },
    });
    const customInterestSlug = `custom-interest-${uniqueSuffix()}`;
    await testPrisma.interest.create({
      data: {
        slug: customInterestSlug,
        name: `Custom ${customInterestSlug}`,
        nameKey: toNameKey(`Custom ${customInterestSlug}`),
      },
    });

    const result = await seedStarterTaxonomy(testPrisma);

    expect(result.totalSkills).toBe(starterSkills.length + 1);
    expect(result.totalInterests).toBe(starterInterests.length + 1);
    expect(
      await testPrisma.skill.findUnique({ where: { slug: customSlug } }),
    ).not.toBeNull();
    expect(
      await testPrisma.interest.findUnique({
        where: { slug: customInterestSlug },
      }),
    ).not.toBeNull();
  });

  it("does not delete user assignments", async () => {
    const user = await seedUser();
    await seedStarterTaxonomy(testPrisma);

    const react = await testPrisma.skill.findUniqueOrThrow({
      where: { slug: "react" },
    });
    const webDev = await testPrisma.interest.findUniqueOrThrow({
      where: { slug: "web-development" },
    });

    await testPrisma.userSkill.create({
      data: {
        userId: user.id,
        skillId: react.id,
        proficiencyLevel: "ADVANCED",
      },
    });
    await testPrisma.userInterest.create({
      data: { userId: user.id, interestId: webDev.id },
    });

    await seedStarterTaxonomy(testPrisma);

    expect(await testPrisma.userSkill.count()).toBe(1);
    expect(await testPrisma.userInterest.count()).toBe(1);
  });

  it("fails closed when an existing row disagrees on the display name", async () => {
    await testPrisma.skill.create({
      data: {
        slug: "react",
        name: "React (fork)",
        nameKey: toNameKey("React (fork)"),
        category: "Frontend",
      },
    });

    const error = await seedStarterTaxonomy(testPrisma).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TaxonomyConflictError);
    expect(
      (error as TaxonomyConflictError).conflicts.some(
        (conflict) => conflict.slug === "react" && conflict.field === "name",
      ),
    ).toBe(true);

    // Fail closed: nothing was written and the existing row is untouched.
    expect(await testPrisma.skill.count()).toBe(1);
    expect(
      (await testPrisma.skill.findUniqueOrThrow({ where: { slug: "react" } }))
        .name,
    ).toBe("React (fork)");
  });

  it("fails closed when an existing row disagrees on the normalized key", async () => {
    await testPrisma.skill.create({
      data: {
        slug: "react",
        name: "React",
        nameKey: "stale-key",
        category: "Frontend",
      },
    });

    const error = await seedStarterTaxonomy(testPrisma).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TaxonomyConflictError);
    expect(
      (error as TaxonomyConflictError).conflicts.some(
        (conflict) => conflict.slug === "react" && conflict.field === "nameKey",
      ),
    ).toBe(true);
    expect(await testPrisma.skill.count()).toBe(1);
  });

  it("fails closed when the display name is already claimed by another slug", async () => {
    await testPrisma.skill.create({
      data: {
        slug: `react-legacy-${uniqueSuffix()}`,
        name: "React",
        nameKey: "react",
        category: "Frontend",
      },
    });

    const error = await seedStarterTaxonomy(testPrisma).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TaxonomyConflictError);
    expect(
      (error as TaxonomyConflictError).conflicts.some(
        (conflict) => conflict.slug === "react" && conflict.field === "name",
      ),
    ).toBe(true);
  });

  it("does not silently rewrite an existing category", async () => {
    await testPrisma.skill.create({
      data: {
        slug: "react",
        name: "React",
        nameKey: "react",
        category: "Some Other Category",
      },
    });

    // Name and key agree, so this is not a conflict and the row is skipped.
    const result = await seedStarterTaxonomy(testPrisma);

    expect(result.skillsSkipped).toBeGreaterThan(0);
    expect(
      (await testPrisma.skill.findUniqueOrThrow({ where: { slug: "react" } }))
        .category,
    ).toBe("Some Other Category");
  });
});

describe("taxonomy read boundary", () => {
  it("lists skills for an active verified session in deterministic order", async () => {
    const user = await seedUser();
    await seedStarterTaxonomy(testPrisma);

    const skills = await listTaxonomySkills(user.user, testPrisma);

    expect(skills).toHaveLength(starterSkills.length);
    expect(skills.map((skill) => skill.slug)).toContain("react");

    const categories = skills.map((skill) => skill.category ?? "");
    const sorted = [...skills].sort((a, b) => {
      const byCategory = (a.category ?? "").localeCompare(b.category ?? "");
      return byCategory === 0 ? a.name.localeCompare(b.name) : byCategory;
    });

    expect(skills.map((skill) => skill.id)).toEqual(
      sorted.map((skill) => skill.id),
    );
    expect(categories.length).toBe(skills.length);
  });

  it("lists interests for an active verified session in name order", async () => {
    const user = await seedUser();
    await seedStarterTaxonomy(testPrisma);

    const interests = await listTaxonomyInterests(user.user, testPrisma);
    const names = interests.map((entry) => entry.name);

    expect(interests).toHaveLength(starterInterests.length);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it("excludes the normalized key and any protected field from the projection", async () => {
    const user = await seedUser();
    await seedStarterTaxonomy(testPrisma);

    const [skill] = await listTaxonomySkills(user.user, testPrisma);
    const [interest] = await listTaxonomyInterests(user.user, testPrisma);

    expect(Object.keys(skill ?? {}).sort()).toEqual([
      "category",
      "id",
      "name",
      "slug",
    ]);
    expect(Object.keys(interest ?? {}).sort()).toEqual(["id", "name", "slug"]);
    expect(skill).not.toHaveProperty("nameKey");
    expect(skill).not.toHaveProperty("createdAt");
  });

  it("rejects a suspended, unverified, or unauthenticated caller", async () => {
    const suspended = await seedUser({ status: "SUSPENDED" });
    const unverified = await seedUser({ verified: false });

    await expect(
      listTaxonomySkills(suspended.user, testPrisma),
    ).rejects.toThrowError("Authentication required");
    await expect(
      listTaxonomySkills(unverified.user, testPrisma),
    ).rejects.toThrowError("Email verification required");
    await expect(listTaxonomySkills(null, testPrisma)).rejects.toThrowError(
      "Authentication required",
    );

    await expect(
      listTaxonomyInterests(suspended.user, testPrisma),
    ).rejects.toThrowError("Authentication required");
    await expect(
      listTaxonomyInterests(unverified.user, testPrisma),
    ).rejects.toThrowError("Email verification required");
    await expect(listTaxonomyInterests(null, testPrisma)).rejects.toThrowError(
      "Authentication required",
    );
  });

  it("returns an empty list when the taxonomy has not been seeded", async () => {
    const user = await seedUser();

    await expect(listTaxonomySkills(user.user, testPrisma)).resolves.toEqual(
      [],
    );
    await expect(listTaxonomyInterests(user.user, testPrisma)).resolves.toEqual(
      [],
    );
  });
});
