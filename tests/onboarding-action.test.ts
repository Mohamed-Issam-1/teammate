import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeOnboardingAction } from "@/features/onboarding/actions";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

const mocks = vi.hoisted(() => ({
  completeOnboardingForSession: vi.fn(),
  prisma: { marker: "test-prisma" },
  requireServerSession: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/server/auth/session", () => ({
  requireServerSession: mocks.requireServerSession,
}));

vi.mock("@/server/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/server/profiles/onboarding", () => ({
  completeOnboardingForSession: mocks.completeOnboardingForSession,
  InvalidOnboardingInputError: class InvalidOnboardingInputError extends Error {},
}));

const session = {
  user: {
    id: "authenticated-user-id",
    name: "Bootstrap Name",
    accountStatus: "ACTIVE",
    emailVerified: true,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("completeOnboardingAction", () => {
  it("returns a safe unauthenticated result without attempting a write", async () => {
    mocks.requireServerSession.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    await expect(
      completeOnboardingAction({ displayName: "Ada" }),
    ).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in to complete onboarding.",
    });
    expect(mocks.completeOnboardingForSession).not.toHaveBeenCalled();
  });

  it("returns a safe verification-required result without attempting a write", async () => {
    mocks.requireServerSession.mockRejectedValue(
      new EmailVerificationRequiredError(),
    );

    await expect(
      completeOnboardingAction({ displayName: "Ada" }),
    ).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Verify your email before completing onboarding.",
    });
    expect(mocks.completeOnboardingForSession).not.toHaveBeenCalled();
  });

  it("rejects invalid or extra input before the database boundary", async () => {
    mocks.requireServerSession.mockResolvedValue(session);

    await expect(
      completeOnboardingAction({
        displayName: "A",
        userId: "another-user",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: {
        displayName: ["Enter a display name between 2 and 80 characters."],
      },
    });
    expect(mocks.completeOnboardingForSession).not.toHaveBeenCalled();
  });

  it("normalizes valid input, derives identity server-side, and revalidates routes", async () => {
    mocks.requireServerSession.mockResolvedValue(session);
    mocks.completeOnboardingForSession.mockResolvedValue({
      displayName: "Ada Lovelace",
      onboardingComplete: true,
      profileExists: true,
      completedNow: true,
    });

    await expect(
      completeOnboardingAction({ displayName: "  Ada Lovelace  " }),
    ).resolves.toEqual({
      ok: true,
      data: { alreadyCompleted: false },
    });
    expect(mocks.completeOnboardingForSession).toHaveBeenCalledWith(
      session,
      { displayName: "Ada Lovelace" },
      mocks.prisma,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/onboarding");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("returns an idempotent success when onboarding was already completed", async () => {
    mocks.requireServerSession.mockResolvedValue(session);
    mocks.completeOnboardingForSession.mockResolvedValue({
      displayName: "Canonical Name",
      onboardingComplete: true,
      profileExists: true,
      completedNow: false,
    });

    await expect(
      completeOnboardingAction({ displayName: "Replacement Name" }),
    ).resolves.toEqual({
      ok: true,
      data: { alreadyCompleted: true },
    });
  });

  it("collapses unexpected database failures to generic copy", async () => {
    mocks.requireServerSession.mockResolvedValue(session);
    mocks.completeOnboardingForSession.mockRejectedValue(
      new Error("Prisma relation error at /srv/profile"),
    );

    const result = await completeOnboardingAction({ displayName: "Ada" });

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't complete onboarding right now. Please try again in a moment.",
    });
    expect(JSON.stringify(result)).not.toMatch(/Prisma|relation error/i);
  });
});
