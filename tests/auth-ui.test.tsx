import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { VerificationResendForm } from "@/features/auth/components/verification-resend-form";

const authMocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(),
  signOut: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("@/features/auth/client", () => ({
  authClient: {
    requestPasswordReset: authMocks.requestPasswordReset,
    resetPassword: authMocks.resetPassword,
    sendVerificationEmail: authMocks.sendVerificationEmail,
    signOut: authMocks.signOut,
    signIn: { email: authMocks.signInEmail },
    signUp: { email: authMocks.signUpEmail },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerMocks.replace }),
}));

const VALID_PASSWORD = "correct-horse-42";

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

async function fillSignUp(
  user: ReturnType<typeof userEvent.setup>,
  options: {
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  } = {},
) {
  await user.type(
    screen.getByLabelText("Full name"),
    options.name ?? "Ada Lovelace",
  );
  await user.type(
    screen.getByLabelText("Email address"),
    options.email ?? "ada@example.com",
  );
  await user.type(
    screen.getByLabelText("Password"),
    options.password ?? VALID_PASSWORD,
  );
  await user.type(
    screen.getByLabelText("Confirm password"),
    options.confirmPassword ?? options.password ?? VALID_PASSWORD,
  );
}

async function fillSignIn(
  user: ReturnType<typeof userEvent.setup>,
  email = "ada@example.com",
  password = VALID_PASSWORD,
) {
  await user.type(screen.getByLabelText("Email address"), email);
  await user.type(screen.getByLabelText("Password"), password);
}

describe("sign-up UI", () => {
  it("renders explicit labels and Zod validation messages", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    expect(screen.getByLabelText("Full name")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-describedby",
      "sign-up-password-policy",
    );
    expect(
      document.getElementById("sign-up-password-policy"),
    ).toHaveTextContent("Use 8 to 128 characters.");
    expect(
      screen.getByRole("button", { name: "Create account" }).closest("form"),
    ).toHaveAttribute("method", "post");

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Enter at least 2 characters."),
    ).toBeVisible();
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(screen.getByText("Use at least 8 characters.")).toBeVisible();
    expect(authMocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation without calling auth", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillSignUp(user, { confirmPassword: "different-password" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeVisible();
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(authMocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("submits only approved fields and treats the generic response as verification-required", async () => {
    const user = userEvent.setup();
    authMocks.signUpEmail.mockResolvedValue({
      data: { token: null, user: { id: "synthetic-user-id" } },
      error: null,
    });
    render(<SignUpForm />);

    await fillSignUp(user, {
      name: "  Ada Lovelace  ",
      email: "  ADA@Example.com  ",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(/check your email for a verification link/i),
    ).toBeVisible();
    expect(authMocks.signUpEmail).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: VALID_PASSWORD,
      callbackURL: "/verify-email?verified=1",
    });
    const submitted = authMocks.signUpEmail.mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty("globalRole");
    expect(submitted).not.toHaveProperty("accountStatus");
    expect(submitted).not.toHaveProperty("emailVerified");
    expect(submitted).not.toHaveProperty("userId");
    expect(routerMocks.replace).toHaveBeenCalledWith("/verify-email");
  });

  it("disables submission and announces progress while sign-up is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: unknown) => void) | undefined;
    const pendingRequest = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    authMocks.signUpEmail.mockReturnValue(pendingRequest);
    render(<SignUpForm />);

    await fillSignUp(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const pendingButton = await screen.findByRole("button", {
      name: "Creating account…",
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    resolveRequest?.({
      data: { token: null, user: { id: "user-id" } },
      error: null,
    });
    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/verify-email");
    });
  });
});

describe("sign-in UI", () => {
  it("shows one generic message for invalid credentials", async () => {
    const user = userEvent.setup();
    authMocks.signInEmail.mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    render(<SignInForm />);

    await fillSignIn(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "The email or password is incorrect. Please try again.",
      ),
    ).toBeVisible();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("shows the safe verification-required state", async () => {
    const user = userEvent.setup();
    authMocks.signInEmail.mockResolvedValue({
      data: null,
      error: { code: "EMAIL_NOT_VERIFIED" },
    });
    render(<SignInForm />);

    await fillSignIn(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(/verify your email before signing in/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Verify your email" }),
    ).toHaveAttribute("href", "/verify-email");
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("collapses an unknown provider exception to a generic message", async () => {
    const user = userEvent.setup();
    authMocks.signInEmail.mockRejectedValue(
      new Error("Prisma failure: reset-token-value"),
    );
    render(<SignInForm />);

    await fillSignIn(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "We couldn't complete that request. Please try again in a moment.",
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Prisma|reset-token/i);
  });

  it("does not reveal a suspended account state", async () => {
    const user = userEvent.setup();
    authMocks.signInEmail.mockResolvedValue({
      data: null,
      error: { code: "SESSION_CREATION_NOT_ALLOWED" },
    });
    render(<SignInForm />);

    await fillSignIn(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "The email or password is incorrect. Please try again.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/suspend|account status/i),
    ).not.toBeInTheDocument();
  });

  it("routes a successful verified sign-in to onboarding", async () => {
    const user = userEvent.setup();
    authMocks.signInEmail.mockResolvedValue({
      data: { token: "session-token", user: { id: "user-id" } },
      error: null,
    });
    render(<SignInForm />);

    await fillSignIn(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(authMocks.signInEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: VALID_PASSWORD,
    });
  });
});

describe("sign-out UI", () => {
  it("uses the native sign-out method and returns to sign-in", async () => {
    const user = userEvent.setup();
    authMocks.signOut.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(authMocks.signOut).toHaveBeenCalledTimes(1);
      expect(routerMocks.replace).toHaveBeenCalledWith("/sign-in");
    });
  });
});

describe("neutral email request UI", () => {
  it("shows the same password-reset confirmation after a successful request", async () => {
    const user = userEvent.setup();
    authMocks.requestPasswordReset.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send reset instructions" }),
    );

    expect(
      await screen.findByText(/if an account matches that email/i),
    ).toBeVisible();
    expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: "/reset-password",
    });
    expect(document.body.textContent).not.toMatch(/token/i);
  });

  it("keeps password-reset copy neutral even when delivery fails", async () => {
    const user = userEvent.setup();
    authMocks.requestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 500, message: "provider failed for existing account" },
    });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send reset instructions" }),
    );

    expect(
      await screen.findByText(/if an account matches that email/i),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/provider|existing account/i);
  });

  it("uses a neutral verification-resend confirmation and safe callback", async () => {
    const user = userEvent.setup();
    authMocks.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    render(<VerificationResendForm />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send verification email" }),
    );

    expect(
      await screen.findByText(/if an account matches that email/i),
    ).toBeVisible();
    expect(authMocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/verify-email?verified=1",
    });
  });
});

describe("reset-password UI", () => {
  it("validates new passwords and matching confirmation", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "different");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Use at least 8 characters.")).toBeVisible();
    expect(screen.getByText("Passwords do not match.")).toBeVisible();
    expect(authMocks.resetPassword).not.toHaveBeenCalled();
  });

  it("shows a safe invalid-link state when a token is expired or already used", async () => {
    const user = userEvent.setup();
    authMocks.resetPassword.mockResolvedValue({
      data: null,
      error: { code: "INVALID_TOKEN" },
    });
    render(<ResetPasswordForm token="consumed-reset-token" />);

    await user.type(screen.getByLabelText("New password"), VALID_PASSWORD);
    await user.type(
      screen.getByLabelText("Confirm new password"),
      VALID_PASSWORD,
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText(
        "This password reset link is invalid, expired, or already used. Request a new one.",
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain("consumed-reset-token");
  });

  it("submits the token and new password, then directs the user to sign in", async () => {
    const user = userEvent.setup();
    authMocks.resetPassword.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    window.history.replaceState({}, "", "/reset-password?token=reset-token");
    render(<ResetPasswordForm token="reset-token" />);

    await user.type(screen.getByLabelText("New password"), VALID_PASSWORD);
    await user.type(
      screen.getByLabelText("Confirm new password"),
      VALID_PASSWORD,
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText(/your password has been reset/i),
    ).toBeVisible();
    expect(authMocks.resetPassword).toHaveBeenCalledWith({
      token: "reset-token",
      newPassword: VALID_PASSWORD,
    });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(document.body.textContent).not.toContain("reset-token");
  });
});
