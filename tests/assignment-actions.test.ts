// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundaryMock = vi.hoisted(() => ({
  saveCurrentSkillAssignment: vi.fn(),
  removeCurrentSkillAssignment: vi.fn(),
  addCurrentInterest: vi.fn(),
  removeCurrentInterest: vi.fn(),
}));

vi.mock("@/server/profiles/current-assignments", () => boundaryMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addInterestAssignmentAction,
  removeInterestAssignmentAction,
  removeSkillAssignmentAction,
  saveSkillAssignmentAction,
} from "@/features/profile/assignment-actions";
import {
  AssignmentNotOnboardedError,
  InvalidAssignmentInputError,
  TaxonomyEntryUnavailableError,
} from "@/server/profiles/assignments";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

const SKILL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const INTEREST_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

const SKILL_PAYLOAD = {
  skillId: SKILL_ID,
  proficiencyLevel: "ADVANCED" as const,
  yearsExperience: 7,
};

beforeEach(() => {
  vi.resetAllMocks();
  boundaryMock.saveCurrentSkillAssignment.mockResolvedValue({
    skillId: SKILL_ID,
    slug: "typescript",
    name: "TypeScript",
    category: "Languages",
    proficiencyLevel: "ADVANCED",
    yearsExperience: 7,
    updated: false,
  });
  boundaryMock.removeCurrentSkillAssignment.mockResolvedValue({
    skillId: SKILL_ID,
  });
  boundaryMock.addCurrentInterest.mockResolvedValue({
    interestId: INTEREST_ID,
    slug: "open-source",
    name: "Open source",
  });
  boundaryMock.removeCurrentInterest.mockResolvedValue({
    interestId: INTEREST_ID,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveSkillAssignmentAction", () => {
  it("accepts a valid submission and reports the saved skill", async () => {
    const result = await saveSkillAssignmentAction({ ...SKILL_PAYLOAD });

    expect(result).toEqual({
      ok: true,
      data: { skillName: "TypeScript", updated: false },
    });
    expect(boundaryMock.saveCurrentSkillAssignment).toHaveBeenCalledTimes(1);
  });

  it("reports an update when the assignment already existed", async () => {
    boundaryMock.saveCurrentSkillAssignment.mockResolvedValue({
      skillId: SKILL_ID,
      slug: "typescript",
      name: "TypeScript",
      category: "Languages",
      proficiencyLevel: "EXPERT",
      yearsExperience: 9,
      updated: true,
    });

    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      proficiencyLevel: "EXPERT",
      yearsExperience: 9,
    });

    expect(result).toEqual({
      ok: true,
      data: { skillName: "TypeScript", updated: true },
    });
  });

  it("passes only the parsed payload to the server boundary", async () => {
    await saveSkillAssignmentAction({
      skillId: SKILL_ID,
      proficiencyLevel: "BEGINNER",
      yearsExperience: "  4  ",
    });

    expect(boundaryMock.saveCurrentSkillAssignment).toHaveBeenCalledWith({
      skillId: SKILL_ID,
      proficiencyLevel: "BEGINNER",
      yearsExperience: 4,
    });
  });

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
  ])("rejects a payload carrying %s before any write", async (field) => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      [field]: "anything",
    });

    expect(result.ok, field).toBe(false);
    expect(boundaryMock.saveCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["negative years", -1],
    ["years above the maximum", 101],
    ["fractional years", 2.5],
    ["exponent notation", "1e2"],
    ["hex years", "0x10"],
    ["arbitrary years", "many"],
  ])("rejects %s before any write", async (_label, yearsExperience) => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      yearsExperience,
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.saveCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  /**
   * A JSON number in exponent notation is the same IEEE-754 value as its plain
   * form, so `1e2` and `100` cannot be told apart after parsing. The result is
   * the in-range value, and every out-of-range numeric form is still rejected.
   */
  it.each([
    ["a negative number", -1],
    ["a number above the maximum", 101],
    ["a fraction", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a huge number", 1e21],
  ])("rejects %s sent as a JSON number", async (_label, yearsExperience) => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      yearsExperience,
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.saveCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  it("normalizes an in-range exponent-notation number to its plain value", async () => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      yearsExperience: 1e2,
    });

    expect(result.ok).toBe(true);
    expect(boundaryMock.saveCurrentSkillAssignment).toHaveBeenCalledWith({
      skillId: SKILL_ID,
      proficiencyLevel: "ADVANCED",
      yearsExperience: 100,
    });
  });

  it.each([
    ["a malformed skill id", "not-a-uuid"],
    ["a slug", "typescript"],
    ["a missing skill id", undefined],
  ])("rejects %s before any write", async (_label, skillId) => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      skillId,
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.saveCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  it("returns per-field validation messages", async () => {
    const result = await saveSkillAssignmentAction({
      ...SKILL_PAYLOAD,
      skillId: "",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a validation failure");
    }

    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.fieldErrors?.skillId).toEqual(["Select a skill."]);
  });

  it("maps a missing skill to a specific, non-revealing message", async () => {
    boundaryMock.saveCurrentSkillAssignment.mockRejectedValue(
      new TaxonomyEntryUnavailableError("skill"),
    );

    await expect(
      saveSkillAssignmentAction({ ...SKILL_PAYLOAD }),
    ).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Selected skill is unavailable.",
    });
  });

  it("maps a missing interest to a specific, non-revealing message", async () => {
    boundaryMock.addCurrentInterest.mockRejectedValue(
      new TaxonomyEntryUnavailableError("interest"),
    );

    await expect(
      addInterestAssignmentAction({ interestId: INTEREST_ID }),
    ).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Selected interest is unavailable.",
    });
  });

  it("maps an incomplete onboarding to a forbidden result", async () => {
    boundaryMock.saveCurrentSkillAssignment.mockRejectedValue(
      new AssignmentNotOnboardedError(),
    );

    await expect(
      saveSkillAssignmentAction({ ...SKILL_PAYLOAD }),
    ).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Finish account setup before managing your selections.",
    });
  });

  it("maps an unverified session to a forbidden result", async () => {
    boundaryMock.addCurrentInterest.mockRejectedValue(
      new EmailVerificationRequiredError(),
    );

    await expect(
      addInterestAssignmentAction({ interestId: INTEREST_ID }),
    ).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Verify your email before managing your selections.",
    });
  });

  it("maps a missing session to an unauthenticated result", async () => {
    boundaryMock.removeCurrentSkillAssignment.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    await expect(
      removeSkillAssignmentAction({ skillId: SKILL_ID }),
    ).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in to manage your selections.",
    });
  });

  it("treats a boundary validation error as a validation failure", async () => {
    boundaryMock.saveCurrentSkillAssignment.mockRejectedValue(
      new InvalidAssignmentInputError(),
    );

    await expect(
      saveSkillAssignmentAction({ ...SKILL_PAYLOAD }),
    ).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Check the selection and try again.",
    });
  });

  it("collapses an unexpected database failure into one generic message", async () => {
    boundaryMock.saveCurrentSkillAssignment.mockRejectedValue(
      Object.assign(new Error("prisma failed"), {
        cause: {
          connectionString: "postgresql://teammate:secret@localhost/db",
        },
      }),
    );

    const result = await saveSkillAssignmentAction({ ...SKILL_PAYLOAD });

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't update your selections right now. Please try again in a moment.",
    });

    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("prisma");
    expect(rendered).not.toContain("postgresql://");
    expect(rendered).not.toContain("secret");
  });

  it("does not leak an internal user id in a generic failure", async () => {
    boundaryMock.addCurrentInterest.mockRejectedValue(
      new Error("foreign key violation on UserInterest for user 8f2c1d"),
    );

    const result = await addInterestAssignmentAction({
      interestId: INTEREST_ID,
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("8f2c1d");
  });
});

describe("removeSkillAssignmentAction", () => {
  it("removes the caller's own assignment", async () => {
    const result = await removeSkillAssignmentAction({ skillId: SKILL_ID });

    expect(result).toEqual({ ok: true, data: { skillId: SKILL_ID } });
    expect(boundaryMock.removeCurrentSkillAssignment).toHaveBeenCalledWith({
      skillId: SKILL_ID,
    });
  });

  it("rejects a payload carrying userId", async () => {
    const result = await removeSkillAssignmentAction({
      skillId: SKILL_ID,
      userId: "someone-else",
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.removeCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  it("rejects a malformed skill id before any write", async () => {
    const result = await removeSkillAssignmentAction({ skillId: "nope" });

    expect(result.ok).toBe(false);
    expect(boundaryMock.removeCurrentSkillAssignment).not.toHaveBeenCalled();
  });

  it("collapses an unexpected failure into one generic message", async () => {
    boundaryMock.removeCurrentSkillAssignment.mockRejectedValue(
      new Error('prisma: relation "Skill" does not exist'),
    );

    const result = await removeSkillAssignmentAction({ skillId: SKILL_ID });

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't update your selections right now. Please try again in a moment.",
    });
    expect(JSON.stringify(result)).not.toContain("prisma");
  });
});

describe("addInterestAssignmentAction", () => {
  it("adds the selected interest", async () => {
    const result = await addInterestAssignmentAction({
      interestId: INTEREST_ID,
    });

    expect(result).toEqual({
      ok: true,
      data: { interestName: "Open source" },
    });
  });

  it.each([
    "userId",
    "profileId",
    "targetUserId",
    "accountStatus",
    "globalRole",
    "name",
    "slug",
    "nameKey",
  ])("rejects a payload carrying %s before any write", async (field) => {
    const result = await addInterestAssignmentAction({
      interestId: INTEREST_ID,
      [field]: "anything",
    });

    expect(result.ok, field).toBe(false);
    expect(boundaryMock.addCurrentInterest).not.toHaveBeenCalled();
  });

  it("rejects a malformed interest id before any write", async () => {
    const result = await addInterestAssignmentAction({ interestId: "nope" });

    expect(result.ok).toBe(false);
    expect(boundaryMock.addCurrentInterest).not.toHaveBeenCalled();
  });
});

describe("removeInterestAssignmentAction", () => {
  it("removes the caller's own assignment", async () => {
    const result = await removeInterestAssignmentAction({
      interestId: INTEREST_ID,
    });

    expect(result).toEqual({ ok: true, data: { interestId: INTEREST_ID } });
  });

  it("rejects a payload carrying userId", async () => {
    const result = await removeInterestAssignmentAction({
      interestId: INTEREST_ID,
      userId: "someone-else",
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.removeCurrentInterest).not.toHaveBeenCalled();
  });

  it("rejects a malformed interest id before any write", async () => {
    const result = await removeInterestAssignmentAction({
      interestId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    expect(boundaryMock.removeCurrentInterest).not.toHaveBeenCalled();
  });
});
