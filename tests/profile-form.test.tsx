import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/features/profile/components/profile-form";
import type { OwnProfile } from "@/server/profiles/own-profile";

const actionMock = vi.hoisted(() => ({
  updateProfileAction: vi.fn(),
}));

vi.mock("@/features/profile/actions", () => actionMock);

const baseProfile: OwnProfile = {
  displayName: "Ada Lovelace",
  headline: "Analytical engine enthusiast",
  bio: "Writes notes about engines.",
  availabilityHoursPerWeek: 12,
  timezone: "Europe/London",
  profileVisibility: "PRIVATE",
};

function renderForm(profile: Partial<OwnProfile> = {}) {
  return render(<ProfileForm profile={{ ...baseProfile, ...profile }} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  actionMock.updateProfileAction.mockResolvedValue({
    ok: true,
    data: { displayName: "Ada Lovelace" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("own profile form", () => {
  it("renders the existing profile values", () => {
    renderForm();

    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Headline")).toHaveValue(
      "Analytical engine enthusiast",
    );
    expect(screen.getByLabelText("Bio")).toHaveValue(
      "Writes notes about engines.",
    );
    expect(screen.getByLabelText("Availability (hours per week)")).toHaveValue(
      12,
    );
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/London");
    expect(screen.getByLabelText("Profile visibility")).toHaveValue("PRIVATE");
  });

  it("renders null optional fields as empty controls", () => {
    renderForm({
      headline: null,
      bio: null,
      availabilityHoursPerWeek: null,
      timezone: null,
    });

    expect(screen.getByLabelText("Headline")).toHaveValue("");
    expect(screen.getByLabelText("Bio")).toHaveValue("");
    expect(screen.getByLabelText("Availability (hours per week)")).toHaveValue(
      null,
    );
    expect(screen.getByLabelText("Time zone")).toHaveValue("");
  });

  it("exposes accessible labels, hints, and a numeric availability input", () => {
    renderForm();

    const displayName = screen.getByLabelText("Display name");
    expect(displayName).toHaveAttribute("autocomplete", "name");
    expect(displayName).toHaveAttribute("aria-describedby");

    const availability = screen.getByLabelText("Availability (hours per week)");
    expect(availability).toHaveAttribute("type", "number");
    expect(availability).toHaveAttribute("min", "0");
    expect(availability).toHaveAttribute("max", "168");
    expect(availability).toHaveAttribute("inputmode", "numeric");

    expect(screen.getByLabelText("Bio").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Profile visibility").tagName).toBe("SELECT");
  });

  it("offers only the approved visibility values", () => {
    renderForm();

    const options = Array.from(
      screen.getByLabelText("Profile visibility").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));

    expect(options).toEqual(["PRIVATE", "MEMBERS_ONLY", "PUBLIC"]);
  });

  it("submits the edited values and confirms success", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Ada King");
    await user.clear(screen.getByLabelText("Headline"));
    await user.type(screen.getByLabelText("Headline"), "Countess of Lovelace");
    await user.clear(screen.getByLabelText("Bio"));
    await user.type(screen.getByLabelText("Bio"), "New biography text.");
    await user.clear(screen.getByLabelText("Availability (hours per week)"));
    await user.type(
      screen.getByLabelText("Availability (hours per week)"),
      "20",
    );
    await user.clear(screen.getByLabelText("Time zone"));
    await user.type(screen.getByLabelText("Time zone"), "Asia/Gaza");
    await user.selectOptions(
      screen.getByLabelText("Profile visibility"),
      "MEMBERS_ONLY",
    );

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(actionMock.updateProfileAction).toHaveBeenCalledTimes(1),
    );
    expect(actionMock.updateProfileAction).toHaveBeenCalledWith({
      displayName: "Ada King",
      headline: "Countess of Lovelace",
      bio: "New biography text.",
      availabilityHoursPerWeek: 20,
      timezone: "Asia/Gaza",
      profileVisibility: "MEMBERS_ONLY",
    });

    expect(
      await screen.findByText("Your profile has been saved."),
    ).toBeVisible();
  });

  it("normalizes cleared optional fields to null before submitting", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText("Headline"));
    await user.clear(screen.getByLabelText("Bio"));
    await user.clear(screen.getByLabelText("Availability (hours per week)"));
    await user.clear(screen.getByLabelText("Time zone"));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(actionMock.updateProfileAction).toHaveBeenCalledTimes(1),
    );
    expect(actionMock.updateProfileAction).toHaveBeenCalledWith(
      expect.objectContaining({
        headline: null,
        bio: null,
        availabilityHoursPerWeek: null,
        timezone: null,
      }),
    );
  });

  it("blocks submission of an invalid display name and shows a field error", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText("Display name"));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText("Enter at least 2 characters."),
    ).toBeVisible();
    expect(actionMock.updateProfileAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Display name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("blocks an out-of-range availability value", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText("Availability (hours per week)"));
    await user.type(
      screen.getByLabelText("Availability (hours per week)"),
      "500",
    );
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText("Enter between 0 and 168 hours."),
    ).toBeVisible();
    expect(actionMock.updateProfileAction).not.toHaveBeenCalled();
  });

  it("blocks an invalid time zone", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText("Time zone"));
    await user.type(screen.getByLabelText("Time zone"), "Not/AZone");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText(
        "Enter a valid time zone, for example Europe/London.",
      ),
    ).toBeVisible();
    expect(actionMock.updateProfileAction).not.toHaveBeenCalled();
  });

  it("surfaces a server field error returned by the action", async () => {
    const user = userEvent.setup();
    actionMock.updateProfileAction.mockResolvedValue({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields and try again.",
      fieldErrors: { displayName: ["That display name is unavailable."] },
    });
    renderForm();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText("That display name is unavailable."),
    ).toBeVisible();
  });

  it("shows a generic message when the action returns a non-field failure", async () => {
    const user = userEvent.setup();
    actionMock.updateProfileAction.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't save your profile right now. Please try again in a moment.",
    });
    renderForm();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText(
        "We couldn't save your profile right now. Please try again in a moment.",
      ),
    ).toBeVisible();
  });

  it("collapses an unexpected thrown error into a generic message", async () => {
    const user = userEvent.setup();
    actionMock.updateProfileAction.mockRejectedValue(
      new Error(
        "prisma: connection to postgresql://teammate:secret@host failed",
      ),
    );
    renderForm();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText(
        "We couldn't save your profile right now. Please try again in a moment.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/postgresql:\/\/teammate:secret/),
    ).not.toBeInTheDocument();
  });

  it("disables the save button while a submission is pending", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    actionMock.updateProfileAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, data: { displayName: "Ada Lovelace" } });
        }),
    );
    renderForm();

    const button = screen.getByRole("button", { name: "Save profile" });
    await user.click(button);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled(),
    );

    release?.();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save profile" }),
      ).toBeEnabled(),
    );
  });

  it("never renders an avatar control or a protected field input", () => {
    renderForm();

    expect(screen.queryByLabelText(/avatar/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[name="avatarUrl"]')).toBeNull();
    expect(document.querySelector('input[name="userId"]')).toBeNull();
    expect(
      document.querySelector('input[name="onboardingCompletedAt"]'),
    ).toBeNull();
    expect(document.querySelector('input[name="globalRole"]')).toBeNull();
    expect(document.querySelector('input[name="accountStatus"]')).toBeNull();
  });
});
