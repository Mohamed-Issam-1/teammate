import { describe, expect, it } from "vitest";

import {
  addInterestAssignmentSchema,
  PROFICIENCY_LEVELS,
  removeInterestAssignmentSchema,
  removeSkillAssignmentSchema,
  saveSkillAssignmentSchema,
  YEARS_EXPERIENCE_MAX,
  YEARS_EXPERIENCE_MIN,
} from "@/features/profile/assignment-validation";

/**
 * Assignment input validation.
 *
 * These tests pin the two properties the server boundary depends on: a
 * well-formed payload is accepted, and anything attempting to smuggle extra
 * fields — a `userId`, an auth field, or a taxonomy field — is rejected rather
 * than stripped. Rejection (not silent dropping) is what makes mass assignment
 * a loud failure instead of a silent partial write.
 */

const SKILL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const INTEREST_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function parseYears(value: unknown) {
  return saveSkillAssignmentSchema.safeParse({
    skillId: SKILL_ID,
    proficiencyLevel: "BEGINNER",
    yearsExperience: value,
  });
}

describe("saveSkillAssignmentSchema", () => {
  it("accepts every approved proficiency level", () => {
    for (const proficiencyLevel of PROFICIENCY_LEVELS) {
      const result = saveSkillAssignmentSchema.safeParse({
        skillId: SKILL_ID,
        proficiencyLevel,
        yearsExperience: null,
      });

      expect(result.success, `${proficiencyLevel} should be accepted`).toBe(
        true,
      );
    }
  });

  it("exposes exactly the four approved proficiency levels", () => {
    expect([...PROFICIENCY_LEVELS]).toEqual([
      "BEGINNER",
      "INTERMEDIATE",
      "ADVANCED",
      "EXPERT",
    ]);
  });

  it.each([
    ["lowercase", "beginner"],
    ["mixed case", "Beginner"],
    ["unknown level", "MASTER"],
    ["empty", ""],
    ["numeric", 2],
    ["null", null],
  ])("rejects a %s proficiency level", (_label, proficiencyLevel) => {
    const result = saveSkillAssignmentSchema.safeParse({
      skillId: SKILL_ID,
      proficiencyLevel,
      yearsExperience: null,
    });

    expect(result.success).toBe(false);
  });

  it("requires skillId", () => {
    expect(
      saveSkillAssignmentSchema.safeParse({
        proficiencyLevel: "BEGINNER",
        yearsExperience: null,
      }).success,
    ).toBe(false);
  });

  it("requires proficiencyLevel", () => {
    expect(
      saveSkillAssignmentSchema.safeParse({ skillId: SKILL_ID }).success,
    ).toBe(false);
  });

  it.each([
    ["not a uuid", "not-a-uuid"],
    ["empty", ""],
    ["truncated", "3f2504e0-4f89-41d3-9a0c"],
    ["wrong shape", "12345"],
    ["a slug", "typescript"],
  ])("rejects a skillId that is %s", (_label, skillId) => {
    expect(
      saveSkillAssignmentSchema.safeParse({
        skillId,
        proficiencyLevel: "BEGINNER",
        yearsExperience: null,
      }).success,
    ).toBe(false);
  });
});

describe("yearsExperience", () => {
  it("normalizes empty browser input to null", () => {
    const result = parseYears("");

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBeNull();
  });

  it("normalizes whitespace-only input to null", () => {
    const result = parseYears("   ");

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBeNull();
  });

  it("accepts an explicit null", () => {
    const result = parseYears(null);

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBeNull();
  });

  it("accepts the lower bound", () => {
    const result = parseYears(YEARS_EXPERIENCE_MIN);

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(0);
  });

  it("accepts the upper bound", () => {
    const result = parseYears(String(YEARS_EXPERIENCE_MAX));

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(100);
  });

  it("exposes an inclusive 0..100 range", () => {
    expect(YEARS_EXPERIENCE_MIN).toBe(0);
    expect(YEARS_EXPERIENCE_MAX).toBe(100);
  });

  it("accepts a value in the middle of the range", () => {
    const result = parseYears("7");

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(7);
  });

  it("trims surrounding whitespace from a valid number", () => {
    const result = parseYears("  5  ");

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(5);
  });

  it.each([
    ["negative", "-1"],
    ["negative zero-ish", "-0.5"],
    ["above the maximum", "101"],
    ["far above the maximum", "1000000"],
    ["fraction", "2.5"],
    ["trailing fraction", "5."],
    ["exponent notation", "1e2"],
    ["capital exponent", "1E2"],
    ["hex", "0x10"],
    ["binary", "0b101"],
    ["octal", "0o17"],
    ["infinity", "Infinity"],
    ["NaN", "NaN"],
    ["arbitrary text", "many"],
    ["years suffix", "5 years"],
    ["thousands separator", "1,000"],
    ["padded sign", "+5"],
  ])("rejects %s", (_label, value) => {
    expect(parseYears(value).success, `${value} should be rejected`).toBe(
      false,
    );
  });

  it.each([
    ["a fractional number", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a negative number", -1],
    ["a number above the maximum", 101],
    ["a huge number", 1e21],
    ["a boolean", true],
    ["an object", { value: 5 }],
    ["an array", [5]],
  ])("rejects %s", (_label, value) => {
    expect(parseYears(value).success).toBe(false);
  });

  /**
   * A JSON number written in exponent notation parses to the same IEEE-754 value
   * as its plain form, so `1e2` and `100` are indistinguishable. Rejecting the
   * notation while accepting the value is not possible, and it would not be
   * desirable either: what matters is that the stored number is an integer inside
   * the approved range. These cases pin that the result is the in-range value,
   * and that every out-of-range numeric form is still rejected.
   */
  it("normalizes an in-range exponent-notation number to its plain value", () => {
    const result = parseYears(1e2);

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(100);
  });

  it("accepts an integral number", () => {
    const result = parseYears(12);

    expect(result.success).toBe(true);
    expect(result.success && result.data.yearsExperience).toBe(12);
  });
});

describe("mass assignment rejection", () => {
  it.each([
    "userId",
    "profileId",
    "targetUserId",
    "ownerId",
    "accountStatus",
    "globalRole",
    "onboardingCompletedAt",
    "name",
    "slug",
    "nameKey",
    "category",
    "id",
  ])("rejects a skill payload carrying %s", (key) => {
    const result = saveSkillAssignmentSchema.safeParse({
      skillId: SKILL_ID,
      proficiencyLevel: "BEGINNER",
      yearsExperience: null,
      [key]: "anything",
    });

    expect(result.success, `${key} must be rejected`).toBe(false);
  });

  it.each([
    "userId",
    "profileId",
    "targetUserId",
    "accountStatus",
    "globalRole",
    "onboardingCompletedAt",
    "name",
    "slug",
    "nameKey",
  ])("rejects an interest payload carrying %s", (key) => {
    const result = addInterestAssignmentSchema.safeParse({
      interestId: INTEREST_ID,
      [key]: "anything",
    });

    expect(result.success, `${key} must be rejected`).toBe(false);
  });
});

describe("removeSkillAssignmentSchema", () => {
  it("accepts a uuid skillId", () => {
    expect(
      removeSkillAssignmentSchema.safeParse({ skillId: SKILL_ID }).success,
    ).toBe(true);
  });

  it("rejects a malformed skillId", () => {
    expect(
      removeSkillAssignmentSchema.safeParse({ skillId: "nope" }).success,
    ).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(
      removeSkillAssignmentSchema.safeParse({
        skillId: SKILL_ID,
        userId: "someone-else",
      }).success,
    ).toBe(false);
  });
});

describe("addInterestAssignmentSchema", () => {
  it("accepts a uuid interestId", () => {
    expect(
      addInterestAssignmentSchema.safeParse({ interestId: INTEREST_ID })
        .success,
    ).toBe(true);
  });

  it.each([
    ["not a uuid", "not-a-uuid"],
    ["empty", ""],
    ["truncated", "9c858901-8a57-4791-81fe"],
    ["a slug", "open-source"],
    ["a number", 12],
  ])("rejects an interestId that is %s", (_label, interestId) => {
    expect(addInterestAssignmentSchema.safeParse({ interestId }).success).toBe(
      false,
    );
  });

  it("requires interestId", () => {
    expect(addInterestAssignmentSchema.safeParse({}).success).toBe(false);
  });
});

describe("removeInterestAssignmentSchema", () => {
  it("accepts a uuid interestId", () => {
    expect(
      removeInterestAssignmentSchema.safeParse({ interestId: INTEREST_ID })
        .success,
    ).toBe(true);
  });

  it("rejects a malformed interestId", () => {
    expect(
      removeInterestAssignmentSchema.safeParse({ interestId: "nope" }).success,
    ).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(
      removeInterestAssignmentSchema.safeParse({
        interestId: INTEREST_ID,
        userId: "someone-else",
      }).success,
    ).toBe(false);
  });
});
