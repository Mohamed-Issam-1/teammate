import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

/** Body of a single Prisma model block, so assertions cannot leak across models. */
function model(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, `model ${name} must exist`).toBeGreaterThan(-1);

  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

function enumBlock(name: string): string {
  const start = schema.indexOf(`enum ${name} {`);
  expect(start, `enum ${name} must exist`).toBeGreaterThan(-1);

  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

describe("canonical Prisma schema", () => {
  it("contains the Better Auth foundation models and database rate limiter", () => {
    for (const name of [
      "User",
      "Session",
      "Account",
      "Verification",
      "RateLimit",
    ]) {
      expect(schema).toContain(`model ${name} {`);
    }

    // Whitespace-insensitive: `prisma format` realigns columns.
    expect(schema).toMatch(/globalRole\s+String\s+@default\("USER"\)/);
    expect(schema).toMatch(/accountStatus\s+String\s+@default\("ACTIVE"\)/);
    expect(schema).toContain("@@unique([key])");
  });

  it("uses the generated Better Auth user id type for the Profile key", () => {
    expect(model("User")).toMatch(/id\s+String\s+@id/);
    expect(model("Profile")).toMatch(/userId\s+String\s+@id/);
    expect(model("Profile")).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
  });

  it("keeps every Phase 1 Profile field", () => {
    const profile = model("Profile");

    for (const field of [
      "userId",
      "displayName",
      "onboardingCompletedAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(profile).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("adds only the approved Phase 2 Profile fields", () => {
    const profile = model("Profile");

    for (const [field, type] of [
      ["headline", "String\\?"],
      ["bio", "String\\?"],
      ["avatarUrl", "String\\?"],
      ["availabilityHoursPerWeek", "Int\\?"],
      ["timezone", "String\\?"],
    ]) {
      expect(profile).toMatch(new RegExp(`${field}\\s+${type}`));
    }

    expect(profile).toMatch(
      /profileVisibility\s+ProfileVisibility\s+@default\(PRIVATE\)/,
    );
  });

  it("excludes fields that are not approved for Phase 2", () => {
    const profile = model("Profile");

    // Deferred by decision: free-text location, a profile slug, social links,
    // academic fields, experience level, teammate preferences, and any AI or
    // search-vector column.
    expect(profile).not.toMatch(
      /\blocation\b|\bslug\b|social|github|twitter|linkedin|university|degree|experienceLevel|embedding|vector|tsvector/i,
    );

    // Deliberately deferred until a discovery query exists.
    expect(profile).not.toContain("@@index([profileVisibility])");
  });

  it("defines the approved enums with exactly the approved values", () => {
    expect(enumBlock("ProfileVisibility")).toMatch(
      /PRIVATE[\s\S]*MEMBERS_ONLY[\s\S]*PUBLIC/,
    );
    expect(enumBlock("ProficiencyLevel")).toMatch(
      /BEGINNER[\s\S]*INTERMEDIATE[\s\S]*ADVANCED[\s\S]*EXPERT/,
    );
  });

  it("keeps taxonomy relation arrays on User rather than Profile", () => {
    const user = model("User");
    const profile = model("Profile");

    expect(user).toMatch(/userSkills\s+UserSkill\[\]/);
    expect(user).toMatch(/userInterests\s+UserInterest\[\]/);

    // Prisma cannot infer a relation transitively through a shared userId, so
    // Profile must not declare taxonomy relations.
    expect(profile).not.toMatch(/UserSkill\[\]|UserInterest\[\]/);
  });

  it("models taxonomy with the approved fields and no timestamps", () => {
    const skill = model("Skill");

    expect(skill).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
    expect(skill).toMatch(/slug\s+String\s+@unique/);
    expect(skill).toMatch(/name\s+String\s+@unique/);
    expect(skill).toMatch(/nameKey\s+String\s+@unique/);
    expect(skill).toMatch(/category\s+String\?/);
    expect(skill).toContain('@@map("Skill")');

    const interest = model("Interest");
    expect(interest).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
    expect(interest).toMatch(/slug\s+String\s+@unique/);
    expect(interest).toMatch(/nameKey\s+String\s+@unique/);
    expect(interest).toMatch(/name\s+String/);
    expect(interest).toContain('@@map("Interest")');

    // Timestamps are documented per entity and are absent for taxonomy.
    for (const body of [skill, interest]) {
      expect(body).not.toMatch(/createdAt|updatedAt/);
    }

    // No @db.Uuid and no database-native uuid default.
    expect(skill).not.toMatch(/@db\.Uuid/);
    expect(interest).not.toMatch(/@db\.Uuid/);
  });

  it("models joins with the approved constraints and referential actions", () => {
    const userSkill = model("UserSkill");

    expect(userSkill).toMatch(/proficiencyLevel\s+ProficiencyLevel/);
    expect(userSkill).toMatch(/yearsExperience\s+Int\?/);
    expect(userSkill).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(userSkill).toMatch(
      /skill\s+Skill\s+@relation\(fields: \[skillId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(userSkill).toContain("@@unique([userId, skillId])");
    expect(userSkill).toContain("@@index([skillId])");
    expect(userSkill).not.toMatch(/createdAt|updatedAt|endorsement|primary/i);

    const userInterest = model("UserInterest");

    expect(userInterest).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(userInterest).toMatch(
      /interest\s+Interest\s+@relation\(fields: \[interestId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(userInterest).toContain("@@unique([userId, interestId])");
    expect(userInterest).toContain("@@index([interestId])");
    expect(userInterest).not.toMatch(/createdAt|updatedAt/);
  });
});
