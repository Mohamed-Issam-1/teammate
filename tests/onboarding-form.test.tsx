import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingForm } from "@/features/onboarding/components/onboarding-form";

const actionMock = vi.hoisted(() => ({
  completeOnboardingAction: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("@/features/onboarding/actions", () => actionMock);
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

beforeEach(() => {
  vi.resetAllMocks();
  routerMock.replace.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("minimal onboarding form", () => {
  it("prefills the display name and exposes accessible form semantics", () => {
    render(<OnboardingForm initialDisplayName="  Ada Lovelace  " />);

    const input = screen.getByLabelText("Display name");
    expect(input).toHaveValue("  Ada Lovelace  ");
    expect(input).toHaveAttribute("autocomplete", "name");
    expect(input).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    ).toBeEnabled();
    expect(input.closest("form")).toHaveAttribute("method", "post");
  });

  it("rejects empty and too-short display names", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm initialDisplayName="" />);

    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );
    expect(
      await screen.findByText("Enter at least 2 characters."),
    ).toBeVisible();

    await user.type(input, "A");
    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );
    expect(
      await screen.findByText("Enter at least 2 characters."),
    ).toBeVisible();
    expect(actionMock.completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("rejects display names longer than 80 characters", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm initialDisplayName="" />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "x".repeat(81) },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );

    expect(
      await screen.findByText("Use no more than 80 characters."),
    ).toBeVisible();
    expect(actionMock.completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("rejects control characters that PostgreSQL text cannot store", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm initialDisplayName="" />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "A\u0000B" },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );

    expect(
      await screen.findByText("Use printable characters only."),
    ).toBeVisible();
    expect(actionMock.completeOnboardingAction).not.toHaveBeenCalled();
  });

  it("submits a valid display name and navigates to the app entry", async () => {
    const user = userEvent.setup();
    actionMock.completeOnboardingAction.mockResolvedValue({
      ok: true,
      data: { alreadyCompleted: false },
    });
    render(<OnboardingForm initialDisplayName="Ada Lovelace" />);

    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "  Grace Hopper  ");
    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );

    await waitFor(() => {
      expect(actionMock.completeOnboardingAction).toHaveBeenCalledWith({
        displayName: "Grace Hopper",
      });
      expect(routerMock.replace).toHaveBeenCalledWith("/app");
    });
  });

  it("disables the submit action while the server action is pending", async () => {
    const user = userEvent.setup();
    let resolveAction: ((value: unknown) => void) | undefined;
    const pendingAction = new Promise((resolve) => {
      resolveAction = resolve;
    });
    actionMock.completeOnboardingAction.mockReturnValue(pendingAction);
    render(<OnboardingForm initialDisplayName="Ada" />);

    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );

    const pendingButton = await screen.findByRole("button", {
      name: "Saving your name…",
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    resolveAction?.({ ok: true, data: { alreadyCompleted: false } });
    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith("/app");
    });
  });

  it("does not render an unexpected server error message", async () => {
    const user = userEvent.setup();
    actionMock.completeOnboardingAction.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Prisma relation error at /srv/profile",
    });
    render(<OnboardingForm initialDisplayName="Ada" />);

    await user.click(
      screen.getByRole("button", { name: "Continue to TeamMate" }),
    );

    expect(
      await screen.findByText(
        "We couldn't complete onboarding right now. Please try again in a moment.",
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Prisma|relation error/i);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
