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
 * The complete first-run journey through the real browser:
 * sign up, verify, sign in, onboard, reach the protected app, then sign out.
 */
test("signs up, verifies, onboards, reaches the protected app, and signs out", async ({
  page,
}) => {
  const identity = uniqueIdentity("journey");

  await signUpThroughUi(page, identity);

  // The link is read only from the isolated E2E capture file.
  const verificationUrl = await waitForAuthLink("verification", identity.email);
  expect(verificationUrl).toContain("/verify-email?token=");

  await gotoApp(page, verificationUrl);
  await expect(page).toHaveURL(/verified=1/);
  await expect(
    page.getByText("Email verification completed successfully."),
  ).toBeVisible();

  await signInThroughUi(page, identity);
  await expect(page).toHaveURL(/\/onboarding/);

  // The signup full name is offered as the starting display name.
  const displayNameField = page.getByLabel("Display name");
  await expect(displayNameField).toHaveValue(identity.name);

  const chosenName = `${identity.name} Verified`;
  await displayNameField.fill(chosenName);
  await page.getByRole("button", { name: "Continue to TeamMate" }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(
    page.getByRole("heading", { name: `Welcome, ${chosenName}` }),
  ).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // The session is gone, so the protected entry is no longer reachable.
  await gotoApp(page, "/app");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole("heading", { name: `Welcome, ${chosenName}` }),
  ).toHaveCount(0);
});
