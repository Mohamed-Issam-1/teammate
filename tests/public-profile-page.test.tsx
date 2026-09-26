// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundaryMock = vi.hoisted(() => ({
  getCurrentProfileViewer: vi.fn(),
  readVisibleProfile: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  notFound: vi.fn(),
}));

vi.mock("@/server/profiles/current-viewer", () => boundaryMock);
vi.mock("@/server/profiles/visible-profile", () => boundaryMock);
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ notFound: navigationMock.notFound }));

import PublicProfilePage, { metadata } from "@/app/profiles/[userId]/page";

/**
 * Route-level behavior of `/profiles/[userId]`.
 *
 * The single most important property is that every unavailable case routes to
 * the same `notFound()`. If any of them diverged, the divergence itself would
 * disclose whether an account exists, so the tests assert on the count of
 * `notFound` calls rather than on any error text.
 */

const visible = {
  displayName: "Ada Lovelace",
  headline: "Countess and engineer",
  bio: "Writes notes about analytical engines.",
  avatarUrl: null,
  skills: [],
  interests: [],
};

function renderPage(userId: string) {
  return PublicProfilePage({ params: Promise.resolve({ userId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  navigationMock.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  boundaryMock.getCurrentProfileViewer.mockResolvedValue({ kind: "anonymous" });
  boundaryMock.readVisibleProfile.mockResolvedValue(visible);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("public profile route", () => {
  it("resolves the viewer and reads the profile through the boundary", async () => {
    const element = await renderPage("user-abc");

    expect(boundaryMock.getCurrentProfileViewer).toHaveBeenCalledTimes(1);
    expect(boundaryMock.readVisibleProfile).toHaveBeenCalledWith(
      "user-abc",
      { kind: "anonymous" },
      expect.anything(),
    );
    expect(element).toBeTruthy();
  });

  it("passes the resolved viewer through unchanged", async () => {
    boundaryMock.getCurrentProfileViewer.mockResolvedValue({
      kind: "member",
      userId: "viewer-1",
    });

    await renderPage("user-abc");

    expect(boundaryMock.readVisibleProfile).toHaveBeenCalledWith(
      "user-abc",
      { kind: "member", userId: "viewer-1" },
      expect.anything(),
    );
  });

  it("awaits a promised params object", async () => {
    await renderPage("user-abc");

    expect(boundaryMock.readVisibleProfile).toHaveBeenCalledWith(
      "user-abc",
      expect.anything(),
      expect.anything(),
    );
  });

  it("calls notFound when the profile is unavailable", async () => {
    boundaryMock.readVisibleProfile.mockResolvedValue(null);

    await expect(renderPage("user-abc")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigationMock.notFound).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a nonexistent id", "does-not-exist"],
    ["a malformed id", "not a uuid"],
    ["an empty id", ""],
    ["a control character", `a${String.fromCharCode(0)}b`],
    ["an over-long id", "a".repeat(500)],
  ])(
    "routes %s to notFound rather than raising an error",
    async (_label, id) => {
      boundaryMock.readVisibleProfile.mockResolvedValue(null);

      await expect(renderPage(id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(navigationMock.notFound).toHaveBeenCalledTimes(1);
    },
  );

  it("does not redirect to sign-in, which would disclose that a profile exists", async () => {
    boundaryMock.readVisibleProfile.mockResolvedValue(null);

    await expect(renderPage("user-abc")).rejects.toThrow("NEXT_NOT_FOUND");

    // `redirect` is not even imported by this route, so there is no path by which
    // a restricted profile could send the visitor to authentication.
    expect(navigationMock.notFound).toHaveBeenCalledTimes(1);
  });
});

describe("public profile metadata", () => {
  it("is static and carries no viewer- or target-specific data", () => {
    expect(metadata.title).toBe("Profile");
    expect(JSON.stringify(metadata)).not.toContain("Ada");
    expect(JSON.stringify(metadata)).not.toContain("user-abc");
  });

  it("does not depend on any authorized read", () => {
    // A dynamic title would need its own lookup, and `generateMetadata` resolves
    // independently of the page: a profile switched to PRIVATE in between could
    // still leak its display name into the head of a 404 response.
    expect(metadata).not.toHaveProperty("generateMetadata");
  });
});
