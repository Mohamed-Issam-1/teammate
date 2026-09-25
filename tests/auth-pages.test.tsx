import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";

vi.mock("@/features/auth/client", () => ({
  authClient: {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendVerificationEmail: vi.fn(),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

describe("verify-email route states", () => {
  it("shows neutral verification guidance and a safe resend form without a token", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Verify your email" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(
      screen.getByText(/check your email for a verification link/i),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/verification token/i);
  });

  it("shows a successful callback state and requires explicit sign-in", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({ verified: "1" }),
      }),
    );

    expect(
      await screen.findByText(/verification completed successfully/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Continue to sign in" }),
    ).toHaveAttribute("href", "/sign-in");
    expect(document.body.textContent).toMatch(/did not create a session/i);
  });

  it("maps an expired verification callback to safe recovery guidance", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          verified: "1",
          error: "TOKEN_EXPIRED",
        }),
      }),
    );

    expect(
      screen.getByText(/verification link is invalid or has expired/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Request a new link" }),
    ).toHaveAttribute("href", "/verify-email");
  });
});

describe("reset-password route states", () => {
  it("does not render a reset form when the token is missing", async () => {
    render(
      await ResetPasswordPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Reset link unavailable" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("uses one safe state for expired, tampered, or already-used tokens", async () => {
    render(
      await ResetPasswordPage({
        searchParams: Promise.resolve({ error: "INVALID_TOKEN" }),
      }),
    );

    expect(
      screen.getByText(
        "This password reset link is invalid, expired, or already used. Request a new one.",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("renders the native reset form for a bounded token without displaying it", async () => {
    render(
      await ResetPasswordPage({
        searchParams: Promise.resolve({ token: "private-reset-token" }),
      }),
    );

    expect(screen.getByLabelText("New password")).toBeVisible();
    expect(screen.getByLabelText("Confirm new password")).toBeVisible();
    expect(document.body.textContent).not.toContain("private-reset-token");
  });
});
