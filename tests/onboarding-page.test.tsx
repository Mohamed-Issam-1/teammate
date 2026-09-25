import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingPage from "@/app/onboarding/page";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";

const sessionMock = vi.hoisted(() => ({
  requireServerSession: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("@/features/auth/client", () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock("@/server/auth/session", () => sessionMock);
vi.mock("next/navigation", () => ({
  ...navigationMock,
  useRouter: () => ({ replace: vi.fn() }),
}));

beforeEach(() => {
  navigationMock.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("onboarding protected entry boundary", () => {
  it("redirects an unauthenticated request without exposing the shell", async () => {
    sessionMock.requireServerSession.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    await expect(OnboardingPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(navigationMock.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("rejects an unverified session according to the existing auth policy", async () => {
    sessionMock.requireServerSession.mockRejectedValue(
      new EmailVerificationRequiredError(),
    );

    await expect(OnboardingPage()).rejects.toThrow(
      "NEXT_REDIRECT:/verify-email",
    );
    expect(navigationMock.redirect).toHaveBeenCalledWith("/verify-email");
  });

  it("allows an active verified session to reach the minimal shell", async () => {
    sessionMock.requireServerSession.mockResolvedValue({
      user: {
        id: "user-id",
        accountStatus: "ACTIVE",
        emailVerified: true,
      },
    });

    render(await OnboardingPage());

    expect(
      screen.getByRole("heading", { name: "Your account is ready" }),
    ).toBeVisible();
    expect(
      screen.getByText(/profile and account setup will continue/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete/i }),
    ).not.toBeInTheDocument();
  });
});
