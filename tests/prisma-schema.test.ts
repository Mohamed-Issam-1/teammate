import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

describe("canonical Phase 1 Prisma schema", () => {
  it("contains the Better Auth foundation models and database rate limiter", () => {
    for (const model of [
      "model User",
      "model Session",
      "model Account",
      "model Verification",
      "model RateLimit",
    ]) {
      expect(schema).toContain(model);
    }

    expect(schema).toContain('globalRole    String    @default("USER")');
    expect(schema).toContain('accountStatus String    @default("ACTIVE")');
    expect(schema).toContain("@@unique([key])");
  });

  it("uses the generated Better Auth user id type for the Profile key", () => {
    expect(schema).toMatch(/model User \{[\s\S]*id\s+String\s+@id/);
    expect(schema).toMatch(/model Profile \{[\s\S]*userId\s+String\s+@id/);
    expect(schema).toContain(
      "user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)",
    );
  });

  it("contains only the approved minimal Profile fields", () => {
    const profile = schema.slice(schema.indexOf("model Profile"));

    expect(profile).toContain("displayName");
    expect(profile).toContain("onboardingCompletedAt");
    expect(profile).toContain("createdAt");
    expect(profile).toContain("updatedAt");
    expect(profile).not.toMatch(
      /headline|bio|avatarUrl|availabilityHoursPerWeek|timezone|profileVisibility/,
    );
  });
});
