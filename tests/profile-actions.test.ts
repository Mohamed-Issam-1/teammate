// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.hoisted(() => ({
  updateCurrentOwnProfile: vi.fn(),
}));

vi.mock("@/server/profiles/current-profile", () => updateMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateProfileAction } from "@/features/profile/actions";
import {
  InvalidProfileInputError,
  ProfileNotOnboardedError,
} from "@/server/profiles/own-profile";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

const VALID = {
  displayName: "Ada Lovelace",
  headline: "Engine enthusiast",
  bio: "A bio.",
  availabilityHoursPerWeek: 12,
  timezone: "Europe/London",
  profileVisibility: "PRIVATE" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  updateMock.updateCurrentOwnProfile.mockResolvedValue({ ...VALID });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateProfileAction", () => {
  it("accepts a valid submission and returns the saved display name", async () => {
    const result = await updateProfileAction({ ...VALID });

    expect(result).toEqual({ ok: true, data: { displayName: "Ada Lovelace" } });
    expect(updateMock.updateCurrentOwnProfile).toHaveBeenCalledTimes(1);
  });

  it("passes only the parsed, normalized payload to the server boundary", async () => {
    await updateProfileAction({
      ...VALID,
      headline: "  spaced  ",
      bio: "   ",
      availabilityHoursPerWeek: "",
      timezone: "",
    });

    expect(updateMock.updateCurrentOwnProfile).toHaveBeenCalledWith({
      displayName: "Ada Lovelace",
      headline: "spaced",
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
      profileVisibility: "PRIVATE",
    });
  });

  it("rejects a protected field before reaching the server boundary", async () => {
    for (const [field, value] of [
      ["userId", "someone-else"],
      ["avatarUrl", "https://attacker.example/x.png"],
      ["onboardingCompletedAt", "2020-01-01T00:00:00.000Z"],
      ["globalRole", "ADMIN"],
      ["accountStatus", "ACTIVE"],
      ["emailVerified", true],
    ] as const) {
      const result = await updateProfileAction({ ...VALID, [field]: value });

      expect(result.ok, field).toBe(false);
    }

    expect(updateMock.updateCurrentOwnProfile).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range availability before any write", async () => {
    for (const value of [-1, 169, 1.5, "abc"]) {
      const result = await updateProfileAction({
        ...VALID,
        availabilityHoursPerWeek: value,
      });

      expect(result.ok, String(value)).toBe(false);
    }

    expect(updateMock.updateCurrentOwnProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid timezone and visibility before any write", async () => {
    const badZone = await updateProfileAction({
      ...VALID,
      timezone: "Not/AZone",
    });
    const badVisibility = await updateProfileAction({
      ...VALID,
      profileVisibility: "ADMIN",
    });

    expect(badZone.ok).toBe(false);
    expect(badVisibility.ok).toBe(false);
    expect(updateMock.updateCurrentOwnProfile).not.toHaveBeenCalled();
  });

  it("returns per-field validation messages", async () => {
    const result = await updateProfileAction({ ...VALID, displayName: "a" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a validation failure");
    }

    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.fieldErrors?.displayName).toEqual([
      "Enter at least 2 characters.",
    ]);
  });

  it("maps policy failures to safe, specific results", async () => {
    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      new ProfileNotOnboardedError(),
    );
    await expect(updateProfileAction({ ...VALID })).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Finish account setup before editing your profile.",
    });

    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      new EmailVerificationRequiredError(),
    );
    await expect(updateProfileAction({ ...VALID })).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Verify your email before editing your profile.",
    });

    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      new AuthenticationRequiredError(),
    );
    await expect(updateProfileAction({ ...VALID })).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in to edit your profile.",
    });

    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      new ProfileNotOnboardedError(),
    );
    await expect(updateProfileAction({ ...VALID })).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Finish account setup before editing your profile.",
    });
  });

  it("collapses an unexpected failure into one generic message with no detail", async () => {
    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      Object.assign(new Error("prisma failed"), {
        cause: {
          connectionString: "postgresql://teammate:secret@localhost/db",
        },
      }),
    );

    const result = await updateProfileAction({ ...VALID });

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't save your profile right now. Please try again in a moment.",
    });

    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("prisma");
    expect(rendered).not.toContain("postgresql://");
    expect(rendered).not.toContain("secret");
  });

  it("treats a boundary validation error as a validation failure", async () => {
    updateMock.updateCurrentOwnProfile.mockRejectedValue(
      new InvalidProfileInputError(),
    );

    const result = await updateProfileAction({ ...VALID });

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields and try again.",
    });
  });
});
