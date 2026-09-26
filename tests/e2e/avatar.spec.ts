import type { Page } from "@playwright/test";

import {
  expect,
  gotoApp,
  setAccountStatus,
  signInThroughUi,
  signUpThroughUi,
  test,
  uniqueIdentity,
  userIdForEmail,
  waitForAuthLink,
} from "./fixtures";

/**
 * Avatar upload, replacement, removal, and authorized delivery in a browser.
 *
 * Storage is the guarded filesystem adapter the end-to-end runner points at a
 * temporary directory, so no object-store credentials are involved. Delivery still
 * goes through the real `/avatars/[token]` route with the real authorization, so
 * these tests exercise the production code path rather than a shortcut.
 *
 * A leaked or stale token is not authorization, so the privacy cases below fetch
 * the avatar URL directly and assert on the HTTP response as well as the page.
 */

async function onboardedUser(page: Page, prefix: string) {
  const identity = uniqueIdentity(prefix);

  await signUpThroughUi(page, identity);
  await gotoApp(page, await waitForAuthLink("verification", identity.email));
  await expect(page).toHaveURL(/verified=1/);

  await signInThroughUi(page, identity);
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByRole("button", { name: "Continue to TeamMate" }).click();
  await expect(page).toHaveURL(/\/app/);

  return identity;
}

/** A small valid PNG, generated rather than committed as a binary fixture. */
function validPngBytes(): Buffer {
  // A 1x1 opaque PNG. Only the decoder cares, and the server decodes it.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/** Upload a file through the visible control, as a user would. */
async function uploadThroughUi(
  page: Page,
  bytes: Buffer,
  name: string,
  mimeType: string,
) {
  // The file input is named "Choose an image" (or "Choose a replacement image"),
  // which keeps it distinct from the submit button's accessible name.
  await page
    .getByLabel(/^Choose an image$|^Choose a replacement image$/)
    .setInputFiles({ name, mimeType, buffer: bytes });

  await page.getByRole("button", { name: /^(Upload|Replace) avatar$/ }).click();
}

/** The rendered avatar image, by its accessible alt text. */
function avatarLocator(page: Page) {
  return page.locator('img[alt$="\'s avatar"]').first();
}

test("uploads, persists, replaces, and removes an own avatar", async ({
  page,
}) => {
  await onboardedUser(page, "avatar-own");

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("heading", { name: "Avatar" })).toBeVisible();

  // No avatar yet: the initials placeholder stands in.
  await expect(page.getByText("Upload avatar")).toBeVisible();
  expect(await avatarLocator(page).count()).toBe(0);

  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();
  await expect(avatarLocator(page)).toBeVisible();

  // Reload from the server, not from client state.
  await gotoApp(page, "/app/profile");
  await expect(avatarLocator(page)).toBeVisible();
  await expect(page.getByText("Your avatar has been replaced.")).toHaveCount(0);

  const firstSrc = await avatarLocator(page).getAttribute("src");
  expect(firstSrc).toMatch(/^\/avatars\/[0-9a-f-]{36}$/);

  // Replace with a second image and confirm a new token is issued.
  await uploadThroughUi(page, validPngBytes(), "replacement.png", "image/png");
  await expect(page.getByText("Your avatar has been replaced.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  const secondSrc = await avatarLocator(page).getAttribute("src");
  expect(secondSrc).toMatch(/^\/avatars\/[0-9a-f-]{36}$/);
  expect(secondSrc).not.toBe(firstSrc);

  // The owner can fetch their own avatar bytes.
  const ownFetch = await page.request.get(secondSrc as string);
  expect(ownFetch.status()).toBe(200);
  expect(ownFetch.headers()["content-type"]).toBe("image/webp");
  expect(ownFetch.headers()["cache-control"]).toContain("no-store");

  // Remove, and confirm the placeholder returns and stays removed.
  await page.getByRole("button", { name: "Remove avatar" }).click();
  await expect(page.getByText("Your avatar has been removed.")).toBeVisible();
  expect(await avatarLocator(page).count()).toBe(0);

  await gotoApp(page, "/app/profile");
  expect(await avatarLocator(page).count()).toBe(0);
  await expect(page.getByRole("heading", { name: "Avatar" })).toBeVisible();

  // The old object is no longer served.
  const removed = await page.request.get(secondSrc as string);
  expect(removed.status()).toBe(404);
});

test("rejects a non-image upload and leaves the avatar unchanged", async ({
  page,
}) => {
  await onboardedUser(page, "avatar-invalid");

  await gotoApp(page, "/app/profile");
  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();

  const before = await avatarLocator(page).getAttribute("src");

  // Plain text, mislabelled as a PNG. The declared type must not matter.
  await uploadThroughUi(
    page,
    Buffer.from("this is not an image at all"),
    "not-an-image.png",
    "image/png",
  );
  await expect(
    page.getByText("That file could not be read as an image."),
  ).toBeVisible();

  // The existing avatar is untouched.
  expect(await avatarLocator(page).getAttribute("src")).toBe(before);
  await expect(page.getByText("Your avatar has been replaced.")).toHaveCount(0);
});

test("rejects an SVG upload even when it is labelled as an image", async ({
  page,
}) => {
  await onboardedUser(page, "avatar-svg");

  await gotoApp(page, "/app/profile");
  await uploadThroughUi(
    page,
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#123456"/></svg>',
    ),
    "vector.svg",
    "image/png",
  );

  await expect(
    page.getByText("Choose a JPEG, PNG, or WebP image."),
  ).toBeVisible();
  expect(await avatarLocator(page).count()).toBe(0);
});

test("serves a PUBLIC avatar to an anonymous visitor", async ({ page }) => {
  const identity = await onboardedUser(page, "avatar-public");
  await gotoApp(page, "/app/profile");
  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();

  await page.getByLabel("Profile visibility").selectOption("PUBLIC");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  const targetId = userIdForEmail(identity.email);

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  try {
    const response = await visitor.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(200);

    // The avatar renders on the public profile for a signed-out visitor.
    const avatar = avatarLocator(visitor);
    await expect(avatar).toBeVisible();

    const src = await avatar.getAttribute("src");
    expect(src).toMatch(/^\/avatars\/[0-9a-f-]{36}$/);

    // The avatar bytes are reachable without a session.
    const fetched = await visitor.request.get(src as string);
    expect(fetched.status()).toBe(200);
    expect(fetched.headers()["content-type"]).toBe("image/webp");
    expect(fetched.headers()["cache-control"]).toContain("no-store");
  } finally {
    await anonymous.close();
  }
});

test("does not serve a PRIVATE avatar to another viewer or anonymously", async ({
  page,
}) => {
  const identity = await onboardedUser(page, "avatar-private");
  await gotoApp(page, "/app/profile");
  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();
  const src = (await avatarLocator(page).getAttribute("src")) as string;

  await page.getByLabel("Profile visibility").selectOption("PRIVATE");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  const targetId = userIdForEmail(identity.email);

  // Anonymous: the token is known but grants nothing.
  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();
  try {
    expect((await visitor.request.get(src)).status()).toBe(404);
    expect((await visitor.goto(`/profiles/${targetId}`))?.status()).toBe(404);
  } finally {
    await anonymous.close();
  }

  // Another eligible member is refused too.
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  try {
    await onboardedUser(otherPage, "avatar-private-other");
    expect((await otherPage.request.get(src)).status()).toBe(404);
  } finally {
    await other.close();
  }

  // The owner still sees it.
  expect((await page.request.get(src)).status()).toBe(200);
});

test("does not serve a MEMBERS_ONLY avatar anonymously", async ({ page }) => {
  await onboardedUser(page, "avatar-members");
  await gotoApp(page, "/app/profile");
  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();
  const src = (await avatarLocator(page).getAttribute("src")) as string;

  await page.getByLabel("Profile visibility").selectOption("MEMBERS_ONLY");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();
  try {
    expect((await visitor.request.get(src)).status()).toBe(404);
  } finally {
    await anonymous.close();
  }

  // An eligible member may read it.
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  try {
    await onboardedUser(otherPage, "avatar-members-other");
    const fetched = await otherPage.request.get(src);
    expect(fetched.status()).toBe(200);
    expect(fetched.headers()["content-type"]).toBe("image/webp");
  } finally {
    await other.close();
  }
});

test("stops serving an avatar once the target is suspended", async ({
  page,
}) => {
  const { email } = await onboardedUser(page, "avatar-suspend");
  await gotoApp(page, "/app/profile");
  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();
  const src = (await avatarLocator(page).getAttribute("src")) as string;

  await page.getByLabel("Profile visibility").selectOption("PUBLIC");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  // PUBLIC visibility, so it is reachable while the target is eligible.
  expect((await page.request.get(src)).status()).toBe(200);

  setAccountStatus(email, "SUSPENDED");

  // Eligibility is checked before visibility, so the token stops working even
  // for the account itself.
  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();
  try {
    expect((await visitor.request.get(src)).status()).toBe(404);
    const targetId = userIdForEmail(email);
    expect((await visitor.goto(`/profiles/${targetId}`))?.status()).toBe(404);
  } finally {
    await anonymous.close();
  }
});

test("returns 404 for an unknown or malformed avatar token", async ({
  page,
}) => {
  await onboardedUser(page, "avatar-token");

  // Deliberately not "..": the URL parser normalizes a dot segment away before
  // the route runs, so it would test the parser rather than this route. Traversal
  // and path-manipulation semantics are pinned at the token-parser boundary in
  // tests/avatar-token.test.ts.
  for (const token of [
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "not-a-uuid",
    "%2e%2e%2fetc%2fpasswd",
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301%00.png",
  ]) {
    const response = await page.request.get(`/avatars/${token}`);
    expect(response.status(), token).toBe(404);
  }
});

test("refuses an unauthenticated upload", async ({ page }) => {
  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  try {
    const response = await visitor.request.post("/api/profile/avatar", {
      multipart: {
        file: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: validPngBytes(),
        },
      },
      headers: { origin: "http://localhost:3100" },
    });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  } finally {
    await anonymous.close();
  }
});

test("refuses a cross-origin upload even when signed in", async ({ page }) => {
  await onboardedUser(page, "avatar-csrf");
  await gotoApp(page, "/app/profile");

  const response = await page.request.post("/api/profile/avatar", {
    multipart: {
      file: {
        name: "avatar.png",
        mimeType: "image/png",
        buffer: validPngBytes(),
      },
    },
    headers: { origin: "https://evil.example" },
  });

  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "FORBIDDEN_ORIGIN" },
  });

  // Nothing was written.
  expect(await avatarLocator(page).count()).toBe(0);
});

test("rejects extra or identity fields in the upload form", async ({
  page,
}) => {
  await onboardedUser(page, "avatar-extra");
  await gotoApp(page, "/app/profile");

  const extraFields: Record<string, string>[] = [
    { userId: "someone-else" },
    { profileId: "someone-else" },
    { avatarUrl: "https://evil.example/x.png" },
    { bucket: "another-bucket" },
  ];

  for (const extra of extraFields) {
    const response = await page.request.post("/api/profile/avatar", {
      multipart: {
        file: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: validPngBytes(),
        },
        ...extra,
      },
      headers: { origin: "http://localhost:3100" },
    });

    expect(response.status(), JSON.stringify(extra)).toBe(400);
  }

  expect(await avatarLocator(page).count()).toBe(0);
});

test("leaves the rest of the profile page working", async ({ page }) => {
  const identity = await onboardedUser(page, "avatar-regression");
  await gotoApp(page, "/app/profile");

  await page.getByLabel("Display name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "React" });
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page.getByText("Added React.")).toBeVisible();

  await uploadThroughUi(page, validPngBytes(), "avatar.png", "image/png");
  await expect(page.getByText("Your avatar has been uploaded.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada Lovelace");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(avatarLocator(page)).toBeVisible();

  // The public profile still renders with the avatar and no private fields.
  const targetId = userIdForEmail(identity.email);
  await page.getByLabel("Profile visibility").selectOption("PUBLIC");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await gotoApp(page, `/profiles/${targetId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
  ).toBeVisible();
  await expect(avatarLocator(page)).toBeVisible();
  await expect(page.getByText("React")).toBeVisible();
});
