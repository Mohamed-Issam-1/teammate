import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppPage from "@/app/app/page";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

const onboardingMock = vi.hoisted(() => ({
  getCurrentOnboardingState: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock("@/features/auth/client", () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock("@/server/profiles/current-onboarding", () => onboardingMock);
vi.mock("next/navigation", () => ({
  redirect: navigationMock.redirect,
  useRouter: navigationMock.useRouter,
}));

beforeEach(() => {
  navigationMock.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  });
  navigationMock.useRouter.mockReturnValue({ replace: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("protected app entry boundary", () => {
  it("redirects an unauthenticated request to sign-in", async () => {
    onboardingMock.getCurrentOnboardingState.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    await expect(AppPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects an unverified request to email verification", async () => {
    onboardingMock.getCurrentOnboardingState.mockRejectedValue(
      new EmailVerificationRequiredError(),
    );

    await expect(AppPage()).rejects.toThrow("NEXT_REDIRECT:/verify-email");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/verify-email");
  });

  it("redirects an active verified user with incomplete onboarding", async () => {
    onboardingMock.getCurrentOnboardingState.mockResolvedValue({
      displayName: "Bootstrap Name",
      onboardingComplete: false,
      profileExists: false,
    });

    await expect(AppPage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("renders the canonical Profile display name for a completed account", async () => {
    onboardingMock.getCurrentOnboardingState.mockResolvedValue({
      displayName: "Canonical Name",
      onboardingComplete: true,
      profileExists: true,
    });

    render(await AppPage());

    expect(
      screen.getByRole("heading", { name: "Welcome, Canonical Name" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/dashboard|projects|teams/i),
    ).not.toBeInTheDocument();
  });
});
