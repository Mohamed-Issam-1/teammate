import {
  expect,
  gotoApp,
  signInThroughUi,
  test,
  uniqueIdentity,
  waitForAuthLink,
} from "./fixtures";

/**
 * Browser-level password reset through the real form.
 *
 * The reset link is read only from the isolated E2E capture file. No mailbox
 * route, API response, or log is used.
 */
test("resets a password and invalidates the previous one", async ({ page }) => {
  const identity = uniqueIdentity("reset");
  const newPassword = "E2E-Rotated-Horse-Battery-99";

  // Establish a verified, signed-in account first.
  await gotoApp(page, "/sign-up");
  await page.getByLabel("Full name").fill(identity.name);
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByLabel("Confirm password").fill(identity.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  await gotoApp(page, await waitForAuthLink("verification", identity.email));
  await expect(page).toHaveURL(/verified=1/);

  await signInThroughUi(page, identity);
  await expect(page).toHaveURL(/\/onboarding/);

  // Request a reset.
  await gotoApp(page, "/forgot-password");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByRole("button", { name: "Send reset instructions" }).click();

  // Neutral confirmation copy, identical to the missing-account case.
  await expect(
    page.getByText(
      "If an account matches that email, password reset instructions are on the way.",
      { exact: false },
    ),
  ).toBeVisible();

  const resetUrl = await waitForAuthLink("password-reset", identity.email);
  expect(resetUrl).toContain("/reset-password/");

  await gotoApp(page, resetUrl);
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();

  await expect(
    page.getByText("Your password has been reset", { exact: false }),
  ).toBeVisible();

  // The old password is rejected with generic copy.
  await signInThroughUi(page, identity);
  await expect(
    page.getByText("The email or password is incorrect", { exact: false }),
  ).toBeVisible();

  // The new password works and routes into onboarding again.
  await signInThroughUi(page, { email: identity.email, password: newPassword });
  await expect(page).toHaveURL(/\/onboarding/);
});
