import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarCard } from "@/features/profile/components/avatar-card";

const clientMock = vi.hoisted(() => ({
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

vi.mock("@/features/profile/avatar-client", () => clientMock);

const AVATAR_URL = "/avatars/3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function pngFile(name = "avatar.png", type = "image/png"): File {
  // A tiny but structurally valid PNG header is enough: the client never decodes.
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return new File([bytes], name, { type });
}

function renderCard(avatarUrl: string | null = null) {
  return render(
    <AvatarCard avatarUrl={avatarUrl} displayName="Ada Lovelace" />,
  );
}

/**
 * Assert an error message is shown exactly once.
 *
 * A duplicated message would be announced twice by a screen reader, because the
 * visible alert already carries `role="alert"`.
 */
async function expectSingleError(message: string) {
  const found = await screen.findAllByText(message);
  expect(found).toHaveLength(1);
  expect(found[0]).toBeVisible();
}

beforeEach(() => {
  vi.resetAllMocks();
  clientMock.uploadAvatar.mockResolvedValue({
    ok: true,
    avatarUrl: AVATAR_URL,
  });
  clientMock.deleteAvatar.mockResolvedValue({ ok: true, avatarUrl: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("avatar card", () => {
  it("shows an initials placeholder when there is no avatar", () => {
    const { container } = renderCard(null);

    expect(
      screen.getByRole("heading", { level: 2, name: "Avatar" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "AL",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the current avatar when one is set", () => {
    const { container } = renderCard(AVATAR_URL);

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", AVATAR_URL);
    expect(image).toHaveAttribute("alt", "Ada Lovelace's avatar");
  });

  it("describes the accepted formats and the size limit", () => {
    renderCard();

    const help = screen.getByText(/JPEG, PNG, or WebP/);
    expect(help).toHaveTextContent("4 MB");
    expect(help).toHaveTextContent("512 by 512");
  });

  it("limits the file input to the accepted types", () => {
    renderCard();

    const input = screen.getByLabelText("Choose an image");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("type", "file");
  });

  it("associates the help text with the input", () => {
    renderCard();

    expect(screen.getByLabelText("Choose an image")).toHaveAttribute(
      "aria-describedby",
      "avatar-file-help",
    );
  });

  it("associates the error with the input when one is shown", async () => {
    const user = userEvent.setup();
    clientMock.uploadAvatar.mockResolvedValue({
      ok: false,
      message: "Choose a JPEG, PNG, or WebP image.",
    });
    renderCard(null);

    await user.upload(screen.getByLabelText("Choose an image"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));
    await expectSingleError("Choose a JPEG, PNG, or WebP image.");

    const input = screen.getByLabelText("Choose an image");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "avatar-file-help avatar-file-error",
    );
  });

  it("offers no remove action until an avatar exists", () => {
    renderCard(null);

    expect(
      screen.queryByRole("button", { name: "Remove avatar" }),
    ).not.toBeInTheDocument();
  });

  it("offers a remove action once an avatar exists", () => {
    renderCard(AVATAR_URL);

    expect(screen.getByRole("button", { name: "Remove avatar" })).toBeEnabled();
  });

  it("uploads a chosen image and shows it", async () => {
    const user = userEvent.setup();
    const { container } = renderCard(null);

    await user.upload(screen.getByLabelText("Choose an image"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));

    await waitFor(() =>
      expect(clientMock.uploadAvatar).toHaveBeenCalledTimes(1),
    );
    expect(clientMock.uploadAvatar.mock.calls[0]?.[0]).toBeInstanceOf(File);

    expect(
      await screen.findByText("Your avatar has been uploaded."),
    ).toBeVisible();
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src", AVATAR_URL),
    );
  });

  it("reports a replacement when an avatar already existed", async () => {
    const user = userEvent.setup();
    renderCard(AVATAR_URL);

    await user.upload(
      screen.getByLabelText("Choose a replacement image"),
      pngFile(),
    );
    await user.click(screen.getByRole("button", { name: "Replace avatar" }));

    expect(
      await screen.findByText("Your avatar has been replaced."),
    ).toBeVisible();
  });

  it("switches the control to replace after a successful upload", async () => {
    const user = userEvent.setup();
    renderCard(null);

    await user.upload(screen.getByLabelText("Choose an image"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));
    await screen.findByText("Your avatar has been uploaded.");

    expect(
      screen.getByLabelText("Choose a replacement image"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove avatar" }),
    ).toBeInTheDocument();
  });

  it("shows a pending state while an upload is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    clientMock.uploadAvatar.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, avatarUrl: AVATAR_URL });
        }),
    );
    renderCard(null);

    await user.upload(screen.getByLabelText("Choose an image"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));

    const pending = await screen.findByRole("button", { name: "Uploading…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Choose an image")).toBeDisabled();

    release?.();

    // A successful upload moves the control into its replace state.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Replace avatar" }),
      ).toBeEnabled(),
    );
  });

  it("shows a pending state while a removal is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    clientMock.deleteAvatar.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, avatarUrl: null });
        }),
    );
    renderCard(AVATAR_URL);

    await user.click(screen.getByRole("button", { name: "Remove avatar" }));

    const pending = await screen.findByRole("button", { name: "Removing…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release?.();

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove avatar" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("surfaces a safe validation error from a rejected upload", async () => {
    const user = userEvent.setup();
    clientMock.uploadAvatar.mockResolvedValue({
      ok: false,
      message: "Choose a JPEG, PNG, or WebP image.",
    });
    renderCard(null);

    await user.upload(screen.getByLabelText("Choose an image"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));

    await expectSingleError("Choose a JPEG, PNG, or WebP image.");
    expect(
      screen.queryByText("Your avatar has been uploaded."),
    ).not.toBeInTheDocument();
  });

  it("leaves the existing avatar in place when a replacement fails", async () => {
    const user = userEvent.setup();
    clientMock.uploadAvatar.mockResolvedValue({
      ok: false,
      message: "Choose an image no larger than 4 MB.",
    });
    const { container } = renderCard(AVATAR_URL);

    await user.upload(
      screen.getByLabelText("Choose a replacement image"),
      pngFile(),
    );
    await user.click(screen.getByRole("button", { name: "Replace avatar" }));

    await expectSingleError("Choose an image no larger than 4 MB.");
    expect(container.querySelector("img")).toHaveAttribute("src", AVATAR_URL);
  });

  it("surfaces a safe error when removal fails and keeps the avatar", async () => {
    const user = userEvent.setup();
    clientMock.deleteAvatar.mockResolvedValue({
      ok: false,
      message:
        "Avatar storage is unavailable right now. Please try again later.",
    });
    const { container } = renderCard(AVATAR_URL);

    await user.click(screen.getByRole("button", { name: "Remove avatar" }));

    await expectSingleError(
      "Avatar storage is unavailable right now. Please try again later.",
    );
    expect(container.querySelector("img")).toHaveAttribute("src", AVATAR_URL);
  });

  it("does nothing but warn when submitted with no file chosen", async () => {
    const user = userEvent.setup();
    renderCard(null);

    await user.click(screen.getByRole("button", { name: "Upload avatar" }));

    await expectSingleError("Choose an image to upload.");
    expect(clientMock.uploadAvatar).not.toHaveBeenCalled();
  });

  it("never exposes a URL or storage token input", () => {
    const { container } = renderCard(AVATAR_URL);

    expect(screen.queryByLabelText(/url/i)).not.toBeInTheDocument();
    for (const name of [
      "avatarUrl",
      "objectKey",
      "bucket",
      "userId",
      "profileId",
    ]) {
      expect(
        container.querySelector(`[name="${name}"]`),
        name,
      ).not.toBeInTheDocument();
    }
  });
});
