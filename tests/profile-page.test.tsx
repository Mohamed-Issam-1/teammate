import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "@/app/app/profile/page";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import { AssignmentNotOnboardedError } from "@/server/profiles/assignments";
import { ProfileNotOnboardedError } from "@/server/profiles/own-profile";

const profileMock = vi.hoisted(() => ({
  getCurrentOwnProfile: vi.fn(),
  getCurrentSkillAssignments: vi.fn(),
  getCurrentInterestAssignments: vi.fn(),
  getCurrentTaxonomySkills: vi.fn(),
  getCurrentTaxonomyInterests: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("@/server/profiles/current-profile", () => ({
  getCurrentOwnProfile: profileMock.getCurrentOwnProfile,
}));
vi.mock("@/server/profiles/current-assignments", () => ({
  getCurrentSkillAssignments: profileMock.getCurrentSkillAssignments,
  getCurrentInterestAssignments: profileMock.getCurrentInterestAssignments,
}));
vi.mock("@/server/taxonomy/current-taxonomy", () => ({
  getCurrentTaxonomySkills: profileMock.getCurrentTaxonomySkills,
  getCurrentTaxonomyInterests: profileMock.getCurrentTaxonomyInterests,
}));
vi.mock("@/features/auth/components/sign-out-button", () => ({
  SignOutButton: () => <div data-testid="sign-out" />,
}));
vi.mock("next/navigation", () => ({
  redirect: navigationMock.redirect,
  useRouter: () => ({ replace: vi.fn() }),
}));

/**
 * The profile page fans out five concurrent reads. Each has its own
 * "not onboarded" error, and `Promise.all` surfaces whichever rejects first, so
 * the page must recognize all of them or a not-onboarded user can reach a server
 * error instead of the `/onboarding` redirect.
 */

const profile = {
  displayName: "Ada Lovelace",
  headline: null,
  bio: null,
  availabilityHoursPerWeek: null,
  timezone: null,
  profileVisibility: "PRIVATE",
};

function mockAll(rejection?: unknown) {
  const resolved = rejection
    ? () => Promise.reject(rejection)
    : () => Promise.resolve(undefined);

  profileMock.getCurrentOwnProfile.mockImplementation(
    rejection ? resolved : () => Promise.resolve(profile),
  );
  profileMock.getCurrentSkillAssignments.mockImplementation(
    rejection ? resolved : () => Promise.resolve([]),
  );
  profileMock.getCurrentInterestAssignments.mockImplementation(
    rejection ? resolved : () => Promise.resolve([]),
  );
  profileMock.getCurrentTaxonomySkills.mockImplementation(
    rejection ? resolved : () => Promise.resolve([]),
  );
  profileMock.getCurrentTaxonomyInterests.mockImplementation(
    rejection ? resolved : () => Promise.resolve([]),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  navigationMock.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("profile page authorization", () => {
  it("redirects an unauthenticated request to sign-in", async () => {
    mockAll(new AuthenticationRequiredError());

    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects an unverified request to email verification", async () => {
    mockAll(new EmailVerificationRequiredError());

    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT:/verify-email");
  });

  it("redirects when the own-profile read reports an incomplete profile", async () => {
    mockAll(new ProfileNotOnboardedError());

    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("redirects when only the assignment reads report an incomplete profile", async () => {
    profileMock.getCurrentOwnProfile.mockResolvedValue(profile);
    profileMock.getCurrentSkillAssignments.mockRejectedValue(
      new AssignmentNotOnboardedError(),
    );
    profileMock.getCurrentInterestAssignments.mockResolvedValue([]);
    profileMock.getCurrentTaxonomySkills.mockResolvedValue([]);
    profileMock.getCurrentTaxonomyInterests.mockResolvedValue([]);

    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("rethrows an unexpected failure rather than redirecting", async () => {
    mockAll(new Error("prisma: connection refused"));

    await expect(ProfilePage()).rejects.toThrow("prisma: connection refused");
    expect(navigationMock.redirect).not.toHaveBeenCalled();
  });

  it("renders the profile form and both taxonomy sections for an onboarded user", async () => {
    profileMock.getCurrentOwnProfile.mockResolvedValue(profile);
    profileMock.getCurrentSkillAssignments.mockResolvedValue([
      {
        skillId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        slug: "typescript",
        name: "TypeScript",
        category: "Languages",
        proficiencyLevel: "EXPERT",
        yearsExperience: 8,
      },
    ]);
    profileMock.getCurrentInterestAssignments.mockResolvedValue([
      {
        interestId: "9c858901-8a57-4791-81fe-4c455b099bc9",
        slug: "open-source",
        name: "Open source",
      },
    ]);
    profileMock.getCurrentTaxonomySkills.mockResolvedValue([
      {
        id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        slug: "typescript",
        name: "TypeScript",
        category: "Languages",
      },
    ]);
    profileMock.getCurrentTaxonomyInterests.mockResolvedValue([
      {
        id: "9c858901-8a57-4791-81fe-4c455b099bc9",
        slug: "open-source",
        name: "Open source",
      },
    ]);

    render(await ProfilePage());

    expect(
      screen.getByRole("heading", { name: "Your profile" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Interests" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();

    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Add or update a skill")).toBeInTheDocument();
    expect(screen.getByLabelText("Add an interest")).toBeInTheDocument();
  });

  it("renders safe empty states when taxonomy is unavailable", async () => {
    profileMock.getCurrentOwnProfile.mockResolvedValue(profile);
    profileMock.getCurrentSkillAssignments.mockResolvedValue([]);
    profileMock.getCurrentInterestAssignments.mockResolvedValue([]);
    profileMock.getCurrentTaxonomySkills.mockResolvedValue([]);
    profileMock.getCurrentTaxonomyInterests.mockResolvedValue([]);

    render(await ProfilePage());

    expect(
      screen.getByText(
        "Skills are not available right now. Please try again later.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Interests are not available right now. Please try again later.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Add or update a skill"),
    ).not.toBeInTheDocument();
  });
});
