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
 * `/profiles/[userId]` through the real browser.
 *
 * The route locator is the user's opaque id. The application deliberately offers
 * no way to learn it, because no page displays or links an internal id, so the
 * tests read it from the guarded test database through a test-only fixture
 * command. That is a stronger privacy assertion than any UI walkthrough: if a
 * future change ever exposed the id on a page, these tests would be the wrong
 * shape to catch it, and the projection tests already forbid it appearing in a
 * rendered profile.
 *
 * Taxonomies come from the approved starter taxonomy the guarded runner seeds
 * into `teammate_test`.
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

/** The opaque locator for an onboarded account. */
async function locatorFor(
  page: Page,
  prefix: string,
): Promise<{
  id: string;
  email: string;
}> {
  const identity = await onboardedUser(page, prefix);
  return { id: userIdForEmail(identity.email), email: identity.email };
}

async function setVisibility(page: Page, visibility: string) {
  await page.getByLabel("Profile visibility").selectOption(visibility);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();
}

async function assignSkillAndInterest(page: Page) {
  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "React" });
  await page.getByLabel("Proficiency").selectOption("ADVANCED");
  await page.getByLabel("Years of experience").fill("9");
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page.getByText("Added React.")).toBeVisible();

  await page
    .getByLabel("Add an interest")
    .selectOption({ label: "Open Source" });
  await page.getByRole("button", { name: "Add interest" }).click();
  await expect(page.getByText("Open Source added.")).toBeVisible();
}

test("serves a PUBLIC profile to an anonymous visitor with the safe projection only", async ({
  page,
}) => {
  const { id: targetId } = await locatorFor(page, "public-target");
  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Ada Lovelace");
  await page.getByLabel("Headline").fill("Countess and engineer");
  await page.getByLabel("Bio").fill("Writes notes about analytical engines.");
  await page.getByLabel("Availability (hours per week)").fill("20");
  await page.getByLabel("Time zone").fill("Europe/London");
  await setVisibility(page, "PUBLIC");
  await assignSkillAndInterest(page);

  // A genuinely fresh context: no cookies, so this is an anonymous request.
  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  try {
    const response = await visitor.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(200);

    await expect(
      visitor.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(visitor.getByText("Countess and engineer")).toBeVisible();
    await expect(
      visitor.getByText("Writes notes about analytical engines."),
    ).toBeVisible();

    await expect(
      visitor.getByRole("heading", { name: "Skills" }),
    ).toBeVisible();
    await expect(visitor.getByText("React")).toBeVisible();
    await expect(visitor.getByText("Advanced")).toBeVisible();

    await expect(
      visitor.getByRole("heading", { name: "Interests" }),
    ).toBeVisible();
    await expect(visitor.getByText("Open Source")).toBeVisible();

    // Private and internal data must be absent from the rendered document.
    const body = (await visitor.locator("body").innerText()).trim();
    for (const forbidden of [
      "9 yr",
      "years",
      "Europe/London",
      "Availability",
      "@teammate-e2e.example",
      targetId,
      "PUBLIC",
      "PRIVATE",
      "MEMBERS_ONLY",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }

    // Nor may it be sitting in the served HTML.
    const html = await visitor.content();
    expect(html).not.toContain("Europe/London");
    expect(html).not.toContain("yearsExperience");
    expect(html).not.toContain("availabilityHoursPerWeek");
  } finally {
    await anonymous.close();
  }
});

test("hides a PRIVATE profile from anonymous and from another member", async ({
  page,
}) => {
  const { id: targetId } = await locatorFor(page, "private-target");
  await gotoApp(page, "/app/profile");
  await setVisibility(page, "PRIVATE");

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();
  try {
    const response = await visitor.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(404);
    await expect(visitor.getByText("Page not found")).toBeVisible();
  } finally {
    await anonymous.close();
  }

  // A second, unrelated active + verified member is refused too.
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  try {
    await onboardedUser(otherPage, "private-other");
    const response = await otherPage.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByText("Page not found")).toBeVisible();
  } finally {
    await other.close();
  }
});

test("serves a PRIVATE profile to its owner, with the safe projection only", async ({
  page,
}) => {
  const { id: targetId } = await locatorFor(page, "private-owner");
  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Grace Hopper");
  await page.getByLabel("Time zone").fill("America/New_York");
  await setVisibility(page, "PRIVATE");
  await assignSkillAndInterest(page);

  await gotoApp(page, `/profiles/${targetId}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Grace Hopper" }),
  ).toBeVisible();
  await expect(page.getByText("React")).toBeVisible();
  await expect(page.getByText("Open Source")).toBeVisible();

  // Owning the profile does not turn this route into the edit page. The
  // assertion is scoped to <main> because the Next.js dev overlay renders its
  // own button outside the page content when running against `next dev`.
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("America/New_York");
  expect(body).not.toContain("9 yr");
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByLabel("Display name")).toHaveCount(0);
});

test("serves a MEMBERS_ONLY profile to a member and hides it from anonymous", async ({
  page,
}) => {
  const { id: targetId } = await locatorFor(page, "members-target");
  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Katherine Johnson");
  await setVisibility(page, "MEMBERS_ONLY");
  await assignSkillAndInterest(page);

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();
  try {
    const response = await visitor.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(404);
    await expect(visitor.getByText("Page not found")).toBeVisible();
  } finally {
    await anonymous.close();
  }

  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  try {
    await onboardedUser(otherPage, "members-viewer");
    const response = await otherPage.goto(`/profiles/${targetId}`);
    expect(response?.status()).toBe(200);
    await expect(
      otherPage.getByRole("heading", { level: 1, name: "Katherine Johnson" }),
    ).toBeVisible();
    await expect(otherPage.getByText("React")).toBeVisible();

    // The member view is the same safe projection, with nothing extra.
    const body = await otherPage.locator("body").innerText();
    expect(body).not.toContain("9 yr");
    expect(body).not.toContain("MEMBERS_ONLY");
    await expect(otherPage.getByRole("main").getByRole("button")).toHaveCount(
      0,
    );
  } finally {
    await other.close();
  }
});

test("hides a profile at an id that does not exist", async ({ page }) => {
  const response = await page.goto(
    "/profiles/this-user-does-not-exist-anywhere",
  );

  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("hides a profile at a malformed locator", async ({ page }) => {
  // Deliberately well-formed path segments that simply are not user ids. A
  // segment like ".." is excluded because the router normalizes it away before
  // the route ever runs, so it would test the URL parser rather than this page.
  for (const locator of ["not-a-uuid", "12345", "a".repeat(200), "%00"]) {
    const response = await page.goto(`/profiles/${locator}`);
    expect(response?.status(), locator).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  }
});

test("renders an identical response for every unavailable case", async ({
  page,
}) => {
  // Four ways a profile can be unavailable, compared against a baseline that
  // refers to nothing at all. If any of them differed in body or in the
  // cache-relevant headers, the route could be used to probe for accounts.
  const { id: privateId } = await locatorFor(page, "eq-private");
  await gotoApp(page, "/app/profile");
  await setVisibility(page, "PRIVATE");

  const { id: membersId } = await locatorFor(page, "eq-members");
  await gotoApp(page, "/app/profile");
  await setVisibility(page, "MEMBERS_ONLY");

  const { id: suspendedId, email: suspendedEmail } = await locatorFor(
    page,
    "eq-suspended",
  );
  await gotoApp(page, "/app/profile");
  await setVisibility(page, "PUBLIC");
  setAccountStatus(suspendedEmail, "SUSPENDED");

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  try {
    const baseline = await visitor.goto("/profiles/no-such-user-at-all");
    expect(baseline?.status()).toBe(404);

    // The property that matters is identical *rendered content* plus identical
    // cache-relevant headers. Raw HTML is deliberately not compared: the RSC
    // flight payload and chunk URLs legitimately differ per route, and the flight
    // payload echoes the requested locator, which the caller already supplied.
    const baselineText = await visitor.locator("body").innerText();
    const baselineHeaders = cacheHeadersOf(baseline);

    const cases: [string, string][] = [
      ["a PRIVATE profile seen anonymously", privateId],
      ["a MEMBERS_ONLY profile seen anonymously", membersId],
      ["a suspended target with PUBLIC visibility", suspendedId],
      ["a malformed locator", "not-a-uuid"],
      ["an over-long locator", "a".repeat(200)],
    ];

    for (const [label, locator] of cases) {
      const response = await visitor.goto(`/profiles/${locator}`);

      expect(response?.status(), label).toBe(404);
      expect(await visitor.locator("body").innerText(), label).toBe(
        baselineText,
      );
      expect(cacheHeadersOf(response), label).toEqual(baselineHeaders);
    }

    // The generic copy may say the page "does not exist", which reveals nothing
    // about any particular profile. What must never appear is a reason, and no
    // target data may appear anywhere in the document.
    for (const forbidden of [
      "Private",
      "private",
      "Members",
      "members",
      "suspend",
      "Suspend",
      "hidden",
      "restricted",
    ]) {
      expect(baselineText, forbidden).not.toContain(forbidden);
    }

    for (const locator of [privateId, membersId, suspendedId]) {
      await visitor.goto(`/profiles/${locator}`);
      const html = await visitor.content();

      for (const forbidden of [privateId, membersId, suspendedId]) {
        // The response may echo the id the caller just asked for, but it must
        // never contain a *different* account's id.
        if (forbidden !== locator) {
          expect(html, forbidden).not.toContain(forbidden);
        }
      }
    }
  } finally {
    await anonymous.close();
  }
});

/**
 * The response headers that could carry viewer- or target-specific data, or that
 * would reveal whether a shared cache stored this particular response.
 */
function cacheHeadersOf(
  response: import("@playwright/test").Response | null,
): Record<string, string> {
  const headers = response?.headers() ?? {};

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) =>
        [
          "cache-control",
          "vary",
          "x-nextjs-cache",
          "content-type",
          "x-powered-by",
        ].includes(name),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

test("hides a PUBLIC profile once the target is suspended", async ({
  page,
}) => {
  const { id: targetId, email } = await locatorFor(page, "suspend-target");
  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Barbara Liskov");
  await setVisibility(page, "PUBLIC");
  await assignSkillAndInterest(page);

  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  try {
    // PUBLIC visibility is real while the target is eligible...
    const before = await visitor.goto(`/profiles/${targetId}`);
    expect(before?.status()).toBe(200);
    await expect(
      visitor.getByRole("heading", { level: 1, name: "Barbara Liskov" }),
    ).toBeVisible();

    // ...and PUBLIC does not override target eligibility.
    setAccountStatus(email, "SUSPENDED");

    const after = await visitor.goto(`/profiles/${targetId}`);
    expect(after?.status()).toBe(404);
    await expect(visitor.getByText("Page not found")).toBeVisible();

    // The not-found page must not explain why.
    const body = await visitor.locator("body").innerText();
    for (const forbidden of ["suspend", "Suspend", "Barbara", "Liskov"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }

    // The owner loses access too, because eligibility is checked before visibility.
    await gotoApp(page, `/profiles/${targetId}`);
    await expect(page.getByText("Page not found")).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("keeps own-profile editing and assignment working alongside the new route", async ({
  page,
}) => {
  const { id: targetId } = await locatorFor(page, "regression");
  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Alan Turing");
  await setVisibility(page, "PUBLIC");
  await assignSkillAndInterest(page);

  await gotoApp(page, `/profiles/${targetId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Alan Turing" }),
  ).toBeVisible();

  // The management surface is unchanged.
  await gotoApp(page, "/app/profile");
  await expect(page.getByLabel("Display name")).toHaveValue("Alan Turing");
  await expect(page.getByLabel("Time zone")).toHaveValue("");
  await page.getByLabel("Headline").fill("Still editable");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await gotoApp(page, `/profiles/${targetId}`);
  await expect(page.getByText("Still editable")).toBeVisible();
  await expect(page.getByText("React")).toBeVisible();
});
