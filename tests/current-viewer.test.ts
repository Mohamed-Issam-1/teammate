// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ getServerSession: vi.fn() }));

vi.mock("@/server/auth/session", () => sessionMock);

import { getCurrentProfileViewer } from "@/server/profiles/current-viewer";

/**
 * Viewer-context resolution.
 *
 * The point of this boundary is that an anonymous visitor is a valid viewer, so
 * it must never throw. The second point is that an authenticated-but-ineligible
 * session is mapped to the weakest tier, so it can never hold a privilege an
 * anonymous visitor lacks.
 */

const eligible = (id: string) => ({
  user: { id, accountStatus: "ACTIVE", emailVerified: true },
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentProfileViewer", () => {
  it("reports an anonymous viewer when there is no session", async () => {
    sessionMock.getServerSession.mockResolvedValue(null);

    await expect(getCurrentProfileViewer()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("reports a member for an active verified session", async () => {
    sessionMock.getServerSession.mockResolvedValue(eligible("user-1"));

    await expect(getCurrentProfileViewer()).resolves.toEqual({
      kind: "member",
      userId: "user-1",
    });
  });

  it("collapses an unverified session to anonymous", async () => {
    sessionMock.getServerSession.mockResolvedValue({
      user: { id: "user-1", accountStatus: "ACTIVE", emailVerified: false },
    });

    await expect(getCurrentProfileViewer()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("collapses a session missing the verified flag to anonymous", async () => {
    sessionMock.getServerSession.mockResolvedValue({
      user: { id: "user-1", accountStatus: "ACTIVE" },
    });

    await expect(getCurrentProfileViewer()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("does not require onboarding of the viewer", async () => {
    // The Source of Truth does not define "member" more narrowly than a
    // signed-in account, so a signed-in user who has not onboarded is still a
    // member for the purpose of viewing someone else's profile.
    sessionMock.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        accountStatus: "ACTIVE",
        emailVerified: true,
        onboardingCompletedAt: null,
      },
    });

    await expect(getCurrentProfileViewer()).resolves.toEqual({
      kind: "member",
      userId: "user-1",
    });
  });

  it("never throws for any session shape", async () => {
    for (const session of [
      null,
      undefined,
      {},
      { user: null },
      { user: {} },
      eligible("user-1"),
    ]) {
      sessionMock.getServerSession.mockResolvedValue(session);

      await expect(getCurrentProfileViewer()).resolves.toHaveProperty("kind");
    }
  });
});
