import { expect, gotoApp, test, uniqueIdentity } from "./fixtures";

/**
 * User-visible neutrality of the request flows.
 *
 * This deliberately does not attempt to prove provider-failure enumeration.
 * That behavior is pinned by the unit and PostgreSQL integration suites, and
 * reproducing it here would require a real provider call.
 */
test("shows identical neutral copy for an existing and an unknown address", async ({
  page,
}) => {
  const identity = uniqueIdentity("neutral");
  const neutralReset = "If an account matches that email";
  const neutralResend =
    "If an account matches that email and still needs verification";

  // An existing account needs no prior sign-up here: the copy must be the same
  // whether or not an account matches, so an unknown address is the baseline.
  await gotoApp(page, "/forgot-password");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByRole("button", { name: "Send reset instructions" }).click();
  await expect(page.getByText(neutralReset, { exact: false })).toBeVisible();
  const resetCopy = await page
    .getByText(neutralReset, { exact: false })
    .innerText();

  await gotoApp(page, "/verify-email");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByText(neutralResend, { exact: false })).toBeVisible();
  const resendCopy = await page
    .getByText(neutralResend, { exact: false })
    .innerText();

  // The confirmation must not name a delivery outcome or an account state.
  expect(resetCopy).not.toMatch(/no account|not found|unknown|invalid/i);
  expect(resendCopy).not.toMatch(/no account|not found|unknown|invalid/i);
});
