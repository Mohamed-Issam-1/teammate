import {
  expect,
  gotoApp,
  signInThroughUi,
  signUpThroughUi,
  test,
  uniqueIdentity,
  waitForAuthLink,
} from "./fixtures";

/**
 * Own-profile editing through the real browser.
 *
 * The account is prepared through the existing safe E2E path (sign up, verify,
 * sign in, onboard) rather than by seeding a shortcut, so the journey under test
 * is the real one.
 */

async function prepareOnboardedUser(
  page: import("@playwright/test").Page,
  prefix: string,
) {
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

test("edits the own profile and persists the values across a reload", async ({
  page,
}) => {
  const identity = await prepareOnboardedUser(page, "profile-edit");

  await gotoApp(page, "/app/profile");
  await expect(
    page.getByRole("heading", { name: "Your profile" }),
  ).toBeVisible();

  // The current saved values are rendered into the form.
  await expect(page.getByLabel("Display name")).toHaveValue(identity.name);
  await expect(page.getByLabel("Profile visibility")).toHaveValue("PRIVATE");

  await page.getByLabel("Display name").fill("Ada King");
  await page.getByLabel("Headline").fill("Countess and engineer");
  await page.getByLabel("Bio").fill("Writes notes about analytical engines.");
  await page.getByLabel("Availability (hours per week)").fill("20");
  await page.getByLabel("Time zone").fill("Asia/Gaza");
  await page.getByLabel("Profile visibility").selectOption("MEMBERS_ONLY");

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  // Reload from the server, not from client state.
  await gotoApp(page, "/app/profile");

  await expect(page.getByLabel("Display name")).toHaveValue("Ada King");
  await expect(page.getByLabel("Headline")).toHaveValue(
    "Countess and engineer",
  );
  await expect(page.getByLabel("Bio")).toHaveValue(
    "Writes notes about analytical engines.",
  );
  await expect(page.getByLabel("Availability (hours per week)")).toHaveValue(
    "20",
  );
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Gaza");
  await expect(page.getByLabel("Profile visibility")).toHaveValue(
    "MEMBERS_ONLY",
  );
});

test("clears optional profile fields back to empty", async ({ page }) => {
  await prepareOnboardedUser(page, "profile-clear");

  await gotoApp(page, "/app/profile");
  await page.getByLabel("Headline").fill("Temporary headline");
  await page.getByLabel("Time zone").fill("Europe/London");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await page.getByLabel("Headline").fill("");
  await page.getByLabel("Time zone").fill("");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(page.getByLabel("Headline")).toHaveValue("");
  await expect(page.getByLabel("Time zone")).toHaveValue("");
});

test("rejects an invalid availability value without saving", async ({
  page,
}) => {
  await prepareOnboardedUser(page, "profile-invalid");

  await gotoApp(page, "/app/profile");
  const availability = page.getByLabel("Availability (hours per week)");
  const before = await availability.inputValue();

  await availability.fill("500");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page.getByText("Enter between 0 and 168 hours.")).toBeVisible();
  await expect(page.getByText("Your profile has been saved.")).toHaveCount(0);

  await gotoApp(page, "/app/profile");
  await expect(page.getByLabel("Availability (hours per week)")).toHaveValue(
    before,
  );
});

test("rejects an invalid time zone without saving", async ({ page }) => {
  await prepareOnboardedUser(page, "profile-tz");

  await gotoApp(page, "/app/profile");
  await page.getByLabel("Time zone").fill("Not/AZone");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(
    page.getByText("Enter a valid time zone, for example Europe/London."),
  ).toBeVisible();
  await expect(page.getByText("Your profile has been saved.")).toHaveCount(0);
});

test("never offers an avatar or protected field control", async ({ page }) => {
  await prepareOnboardedUser(page, "profile-noavatar");

  await gotoApp(page, "/app/profile");

  await expect(page.getByLabel(/avatar/i)).toHaveCount(0);
  for (const name of [
    "avatarUrl",
    "userId",
    "onboardingCompletedAt",
    "globalRole",
    "accountStatus",
  ]) {
    await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
  }
});

test("redirects an unauthenticated visitor from /app/profile to /sign-in", async ({
  page,
}) => {
  await gotoApp(page, "/app/profile");

  await expect(page).toHaveURL(/\/sign-in/);
});

test("redirects an incomplete user from /app/profile to /onboarding", async ({
  page,
}) => {
  const identity = uniqueIdentity("profile-incomplete");

  await signUpThroughUi(page, identity);
  await gotoApp(page, await waitForAuthLink("verification", identity.email));
  await expect(page).toHaveURL(/verified=1/);

  await signInThroughUi(page, identity);
  await expect(page).toHaveURL(/\/onboarding/);

  await gotoApp(page, "/app/profile");
  await expect(page).toHaveURL(/\/onboarding/);
});
