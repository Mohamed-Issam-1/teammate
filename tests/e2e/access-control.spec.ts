import {
  expect,
  gotoApp,
  signInThroughUi,
  signUpThroughUi,
  test,
  uniqueIdentity,
  waitForAuthLink,
} from "./fixtures";

/** Real browser coverage for the routing and access-control boundaries. */
test.describe("access control", () => {
  test("redirects an unauthenticated visitor from /onboarding to /sign-in", async ({
    page,
  }) => {
    await gotoApp(page, "/onboarding");

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("redirects an unauthenticated visitor from /app to /sign-in", async ({
    page,
  }) => {
    await gotoApp(page, "/app");

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sends a signed-in but incomplete user from /app to /onboarding", async ({
    page,
  }) => {
    const identity = uniqueIdentity("incomplete");

    await signUpThroughUi(page, identity);
    await gotoApp(page, await waitForAuthLink("verification", identity.email));
    await expect(page).toHaveURL(/verified=1/);

    await signInThroughUi(page, identity);
    await expect(page).toHaveURL(/\/onboarding/);

    await gotoApp(page, "/app");
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("sends a completed user from /onboarding to /app", async ({ page }) => {
    const identity = uniqueIdentity("complete");

    await signUpThroughUi(page, identity);
    await gotoApp(page, await waitForAuthLink("verification", identity.email));
    await expect(page).toHaveURL(/verified=1/);

    await signInThroughUi(page, identity);
    await expect(page).toHaveURL(/\/onboarding/);

    await page.getByRole("button", { name: "Continue to TeamMate" }).click();
    await expect(page).toHaveURL(/\/app/);

    await gotoApp(page, "/onboarding");
    await expect(page).toHaveURL(/\/app/);
  });

  test("invalidates the session on sign out", async ({ page }) => {
    const identity = uniqueIdentity("signout");

    await signUpThroughUi(page, identity);
    await gotoApp(page, await waitForAuthLink("verification", identity.email));
    await expect(page).toHaveURL(/verified=1/);

    await signInThroughUi(page, identity);
    await page.getByRole("button", { name: "Continue to TeamMate" }).click();
    await expect(page).toHaveURL(/\/app/);

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // A fresh navigation must not restore access.
    await gotoApp(page, "/app");
    await expect(page).toHaveURL(/\/sign-in/);

    await gotoApp(page, "/onboarding");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
