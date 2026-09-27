import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase, testPrisma } from "./fixtures";

/**
 * Phase 3 Checkpoint 2 database-constraint tests.
 *
 * These assert what the database actually enforces against real PostgreSQL for
 * the Project, ProjectRequiredSkill, and ProjectInterest models.
 *
 * Application-level range validation (desiredTeamSize 2..50,
 * expectedHoursPerWeek 1..168, importance 1..5) is intentionally NOT tested
 * here — those are Zod/server contracts for later checkpoints, not database
 * constraints.
 */

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}${randomUUID().slice(0, 8)}`;
}

async function createUser(prefix = "phase3-project") {
  const suffix = uniqueSuffix();
  const email = `${prefix}-${suffix}@teammate-test.example`;

  return testPrisma.user.create({
    data: { id: `user-${suffix}`, name: `Phase Three ${suffix}`, email },
  });
}

async function createProject(
  input: {
    ownerId: string;
    title?: string;
    summary?: string;
    description?: string;
    desiredTeamSize?: number;
    expectedHoursPerWeek?: number | null;
  } = { ownerId: "unused" },
) {
  const suffix = uniqueSuffix();

  return testPrisma.project.create({
    data: {
      ownerId: input.ownerId,
      title: input.title ?? `Project ${suffix}`,
      summary: input.summary ?? `Summary ${suffix}`,
      description: input.description ?? `Description ${suffix}`,
      desiredTeamSize: input.desiredTeamSize ?? 5,
      ...(input.expectedHoursPerWeek === undefined
        ? {}
        : { expectedHoursPerWeek: input.expectedHoursPerWeek }),
    },
  });
}

async function createSkill() {
  const suffix = uniqueSuffix();
  const name = `Skill ${suffix}`;

  return testPrisma.skill.create({
    data: {
      slug: `skill-${suffix}`,
      name,
      nameKey: name.toLowerCase(),
    },
  });
}

async function createInterest() {
  const suffix = uniqueSuffix();
  const name = `Interest ${suffix}`;

  return testPrisma.interest.create({
    data: { slug: `interest-${suffix}`, name, nameKey: name.toLowerCase() },
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

describe("Project creation", () => {
  it("creates a project with only required fields and generates an id", async () => {
    const user = await createUser("project-create");

    const project = await createProject({ ownerId: user.id });

    expect(project.id).toEqual(expect.any(String));
    expect(project.id.length).toBeGreaterThan(0);
    expect(project.ownerId).toBe(user.id);
    expect(project.title).toContain("Project ");
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
  });

  it("defaults visibility to PRIVATE", async () => {
    const user = await createUser("project-default-vis");

    const project = await createProject({ ownerId: user.id });

    expect(project.visibility).toBe("PRIVATE");
  });

  it("defaults status to DRAFT", async () => {
    const user = await createUser("project-default-status");

    const project = await createProject({ ownerId: user.id });

    expect(project.status).toBe("DRAFT");
  });

  it("defaults archivedAt to null", async () => {
    const user = await createUser("project-default-archived");

    const project = await createProject({ ownerId: user.id });

    expect(project.archivedAt).toBeNull();
  });

  it("allows expectedHoursPerWeek to be null", async () => {
    const user = await createUser("project-null-hours");

    const project = await createProject({
      ownerId: user.id,
      expectedHoursPerWeek: null,
    });

    expect(project.expectedHoursPerWeek).toBeNull();
  });

  it("persists all provided fields", async () => {
    const user = await createUser("project-full");

    const project = await createProject({
      ownerId: user.id,
      title: "Full Project",
      summary: "A complete summary",
      description: "A thorough description",
      desiredTeamSize: 10,
      expectedHoursPerWeek: 20,
    });

    expect(project.title).toBe("Full Project");
    expect(project.summary).toBe("A complete summary");
    expect(project.description).toBe("A thorough description");
    expect(project.desiredTeamSize).toBe(10);
    expect(project.expectedHoursPerWeek).toBe(20);
  });

  it("accepts all visibility values", async () => {
    const user = await createUser("project-vis-values");

    const pub = await testPrisma.project.create({
      data: {
        ownerId: user.id,
        title: "Public Project",
        summary: "Summary",
        description: "Description",
        desiredTeamSize: 3,
        visibility: "PUBLIC",
      },
    });
    const priv = await testPrisma.project.create({
      data: {
        ownerId: user.id,
        title: "Private Project",
        summary: "Summary",
        description: "Description",
        desiredTeamSize: 3,
        visibility: "PRIVATE",
      },
    });

    expect(pub.visibility).toBe("PUBLIC");
    expect(priv.visibility).toBe("PRIVATE");
  });

  it("accepts all status values", async () => {
    const user = await createUser("project-status-values");

    for (const status of [
      "DRAFT",
      "OPEN",
      "IN_PROGRESS",
      "COMPLETED",
      "ARCHIVED",
    ] as const) {
      const project = await testPrisma.project.create({
        data: {
          ownerId: user.id,
          title: `Project ${status}`,
          summary: "Summary",
          description: "Description",
          desiredTeamSize: 3,
          status,
        },
      });

      expect(project.status).toBe(status);
    }
  });
});

describe("Project owner relation", () => {
  it("succeeds with a valid owner", async () => {
    const user = await createUser("project-owner-valid");

    const project = await createProject({ ownerId: user.id });

    expect(project.ownerId).toBe(user.id);
  });

  it("rejects an invalid owner foreign key", async () => {
    const error = await createProject({
      ownerId: "user-does-not-exist",
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("restricts deleting an owner while projects exist", async () => {
    const user = await createUser("project-owner-restrict");
    await createProject({ ownerId: user.id });

    const error = await testPrisma.user.delete({ where: { id: user.id } }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(isForeignKeyViolation(error)).toBe(true);
    expect(await testPrisma.project.count()).toBe(1);
  });

  it("allows deleting an owner with no projects", async () => {
    const user = await createUser("project-owner-clean-delete");

    await testPrisma.user.delete({ where: { id: user.id } });

    expect(
      await testPrisma.user.findUnique({ where: { id: user.id } }),
    ).toBeNull();
  });
});

describe("ProjectRequiredSkill constraints", () => {
  it("accepts a valid relation", async () => {
    const user = await createUser("prs-valid");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();

    const row = await testPrisma.projectRequiredSkill.create({
      data: {
        projectId: project.id,
        skillId: skill.id,
        importance: 3,
      },
    });

    expect(row.projectId).toBe(project.id);
    expect(row.skillId).toBe(skill.id);
    expect(row.importance).toBe(3);
    expect(row.minimumProficiency).toBeNull();
  });

  it("rejects a duplicate (projectId, skillId) pair", async () => {
    const user = await createUser("prs-dupe");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();

    await testPrisma.projectRequiredSkill.create({
      data: { projectId: project.id, skillId: skill.id, importance: 2 },
    });

    const error = await testPrisma.projectRequiredSkill
      .create({
        data: { projectId: project.id, skillId: skill.id, importance: 4 },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects a nonexistent project foreign key", async () => {
    const skill = await createSkill();

    const error = await testPrisma.projectRequiredSkill
      .create({
        data: {
          projectId: "00000000-0000-4000-8000-000000000000",
          skillId: skill.id,
          importance: 3,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("rejects a nonexistent skill foreign key", async () => {
    const user = await createUser("prs-missing-skill");
    const project = await createProject({ ownerId: user.id });

    const error = await testPrisma.projectRequiredSkill
      .create({
        data: {
          projectId: project.id,
          skillId: "00000000-0000-4000-8000-000000000000",
          importance: 3,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("cascades when the project is deleted", async () => {
    const user = await createUser("prs-cascade-project");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();

    await testPrisma.projectRequiredSkill.create({
      data: { projectId: project.id, skillId: skill.id, importance: 3 },
    });

    await testPrisma.project.delete({ where: { id: project.id } });

    expect(await testPrisma.projectRequiredSkill.count()).toBe(0);
  });

  it("restricts deleting a referenced skill", async () => {
    const user = await createUser("prs-restrict-skill");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();

    await testPrisma.projectRequiredSkill.create({
      data: { projectId: project.id, skillId: skill.id, importance: 3 },
    });

    const error = await testPrisma.skill
      .delete({ where: { id: skill.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
    expect(await testPrisma.skill.count()).toBe(1);
  });

  it("allows minimumProficiency to be null", async () => {
    const user = await createUser("prs-null-proficiency");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();

    const row = await testPrisma.projectRequiredSkill.create({
      data: {
        projectId: project.id,
        skillId: skill.id,
        importance: 3,
        minimumProficiency: null,
      },
    });

    expect(row.minimumProficiency).toBeNull();
  });

  it("accepts all ProficiencyLevel values", async () => {
    const user = await createUser("prs-proficiency-values");
    const project = await createProject({ ownerId: user.id });

    for (const level of [
      "BEGINNER",
      "INTERMEDIATE",
      "ADVANCED",
      "EXPERT",
    ] as const) {
      const skill = await createSkill();
      const row = await testPrisma.projectRequiredSkill.create({
        data: {
          projectId: project.id,
          skillId: skill.id,
          importance: 3,
          minimumProficiency: level,
        },
      });

      expect(row.minimumProficiency).toBe(level);
    }
  });
});

describe("ProjectInterest constraints", () => {
  it("accepts a valid relation", async () => {
    const user = await createUser("pi-valid");
    const project = await createProject({ ownerId: user.id });
    const interest = await createInterest();

    const row = await testPrisma.projectInterest.create({
      data: { projectId: project.id, interestId: interest.id },
    });

    expect(row.projectId).toBe(project.id);
    expect(row.interestId).toBe(interest.id);
  });

  it("rejects a duplicate (projectId, interestId) pair", async () => {
    const user = await createUser("pi-dupe");
    const project = await createProject({ ownerId: user.id });
    const interest = await createInterest();

    await testPrisma.projectInterest.create({
      data: { projectId: project.id, interestId: interest.id },
    });

    const error = await testPrisma.projectInterest
      .create({ data: { projectId: project.id, interestId: interest.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("rejects a nonexistent project foreign key", async () => {
    const interest = await createInterest();

    const error = await testPrisma.projectInterest
      .create({
        data: {
          projectId: "00000000-0000-4000-8000-000000000000",
          interestId: interest.id,
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("rejects a nonexistent interest foreign key", async () => {
    const user = await createUser("pi-missing-interest");
    const project = await createProject({ ownerId: user.id });

    const error = await testPrisma.projectInterest
      .create({
        data: {
          projectId: project.id,
          interestId: "00000000-0000-4000-8000-000000000000",
        },
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("cascades when the project is deleted", async () => {
    const user = await createUser("pi-cascade-project");
    const project = await createProject({ ownerId: user.id });
    const interest = await createInterest();

    await testPrisma.projectInterest.create({
      data: { projectId: project.id, interestId: interest.id },
    });

    await testPrisma.project.delete({ where: { id: project.id } });

    expect(await testPrisma.projectInterest.count()).toBe(0);
  });

  it("restricts deleting a referenced interest", async () => {
    const user = await createUser("pi-restrict-interest");
    const project = await createProject({ ownerId: user.id });
    const interest = await createInterest();

    await testPrisma.projectInterest.create({
      data: { projectId: project.id, interestId: interest.id },
    });

    const error = await testPrisma.interest
      .delete({ where: { id: interest.id } })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isForeignKeyViolation(error)).toBe(true);
    expect(await testPrisma.interest.count()).toBe(1);
  });
});

describe("Project deletion cleanup", () => {
  it("cascades both join tables when a project is deleted", async () => {
    const user = await createUser("project-cascade-all");
    const project = await createProject({ ownerId: user.id });
    const skill = await createSkill();
    const interest = await createInterest();

    await testPrisma.projectRequiredSkill.create({
      data: { projectId: project.id, skillId: skill.id, importance: 3 },
    });
    await testPrisma.projectInterest.create({
      data: { projectId: project.id, interestId: interest.id },
    });

    await testPrisma.project.delete({ where: { id: project.id } });

    expect(await testPrisma.projectRequiredSkill.count()).toBe(0);
    expect(await testPrisma.projectInterest.count()).toBe(0);
    expect(await testPrisma.skill.count()).toBe(1);
    expect(await testPrisma.interest.count()).toBe(1);
  });

  it("allows deleting an unreferenced project", async () => {
    const user = await createUser("project-clean-delete");
    const project = await createProject({ ownerId: user.id });

    await testPrisma.project.delete({ where: { id: project.id } });

    expect(await testPrisma.project.count()).toBe(0);
  });
});
