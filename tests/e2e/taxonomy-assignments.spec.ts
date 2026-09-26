import type { Page } from "@playwright/test";

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
 * Own skill and interest assignment through the real browser.
 *
 * The account is prepared through the existing safe E2E path (sign up, verify,
 * sign in, onboard) rather than by a seeding shortcut, so the journey under test
 * is the real one. Skills and interests come from the approved starter taxonomy,
 * which the guarded E2E runner seeds into `teammate_test` before the app starts;
 * no test creates a taxonomy row.
 */

async function prepareOnboardedUser(page: Page, prefix: string) {
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

/**
 * The single assigned entry containing `text`.
 *
 * Scoped to the assignment list because a skill name and a proficiency level also
 * appear in the selectors' `<option>` elements. Matching on the "yr" fragment
 * rather than the whole rendered line keeps the assertion independent of the
 * separator used between level and years.
 */
function assignedEntry(page: Page, text: string) {
  return page.getByRole("listitem").filter({ hasText: text });
}

test("adds a skill, persists it, updates it without duplicating, then removes it", async ({
  page,
}) => {
  await prepareOnboardedUser(page, "skill-assign");

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(
    page.getByText("You have not added any skills yet."),
  ).toBeVisible();

  // The selector is populated from the approved taxonomy, grouped by category.
  // `<optgroup>` has no layout box of its own, so grouping is asserted by
  // presence and label rather than by visibility.
  const skillSelect = page.getByLabel("Add or update a skill");
  await expect(skillSelect).toBeVisible();
  await expect(skillSelect.locator("optgroup")).not.toHaveCount(0);
  await expect(skillSelect.locator('optgroup[label="Frontend"]')).toHaveCount(
    1,
  );
  await expect(
    skillSelect.locator('optgroup[label="Frontend"] option', {
      hasText: "React",
    }),
  ).toHaveCount(1);

  await skillSelect.selectOption({ label: "React" });
  await page.getByLabel("Proficiency").selectOption("ADVANCED");
  await page.getByLabel("Years of experience").fill("7");
  await page.getByRole("button", { name: "Save skill" }).click();

  await expect(page.getByText("Added React.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(assignedEntry(page, "Advanced")).toBeVisible();
  await expect(assignedEntry(page, "7 yr")).toBeVisible();

  // Reload from the server, not from client state.
  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(assignedEntry(page, "Advanced")).toBeVisible();
  await expect(assignedEntry(page, "7 yr")).toBeVisible();

  // Re-submitting the same skill updates the assignment rather than adding one.
  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "React" });
  await page.getByLabel("Proficiency").selectOption("EXPERT");
  await page.getByLabel("Years of experience").fill("9");
  await page.getByRole("button", { name: "Save skill" }).click();

  await expect(page.getByText("Updated React.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(assignedEntry(page, "Expert")).toBeVisible();
  await expect(assignedEntry(page, "9 yr")).toBeVisible();

  await page.getByRole("button", { name: "Remove React" }).click();
  await expect(page.getByText("Skill removed.")).toBeVisible();
  await expect(
    page.getByText("You have not added any skills yet."),
  ).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(
    page.getByText("You have not added any skills yet."),
  ).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("saves a skill with no years of experience", async ({ page }) => {
  await prepareOnboardedUser(page, "skill-noyears");

  await gotoApp(page, "/app/profile");
  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "Python" });
  await page.getByLabel("Proficiency").selectOption("BEGINNER");
  await page.getByLabel("Years of experience").fill("");
  await page.getByRole("button", { name: "Save skill" }).click();

  await expect(page.getByText("Added Python.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(assignedEntry(page, "Beginner")).toHaveCount(1);
  await expect(assignedEntry(page, "Python")).toHaveCount(1);
  // No years suffix is rendered when the value is null.
  await expect(page.getByText(/\d+\s*yr/)).toHaveCount(0);
});

test("keeps several skills distinct", async ({ page }) => {
  await prepareOnboardedUser(page, "skill-multi");

  await gotoApp(page, "/app/profile");

  for (const [skill, proficiency] of [
    ["React", "ADVANCED"],
    ["PostgreSQL", "INTERMEDIATE"],
  ] as const) {
    await page
      .getByLabel("Add or update a skill")
      .selectOption({ label: skill });
    await page.getByLabel("Proficiency").selectOption(proficiency);
    await page.getByRole("button", { name: "Save skill" }).click();
    await expect(page.getByText(`Added ${skill}.`)).toBeVisible();
  }

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(
    page.getByRole("listitem").filter({ hasText: "PostgreSQL" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Remove React" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Intermediate" }),
  ).toHaveCount(1);
});

test("rejects an out-of-range years value without saving", async ({ page }) => {
  await prepareOnboardedUser(page, "skill-range");

  await gotoApp(page, "/app/profile");
  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "Linux" });
  await page.getByLabel("Years of experience").fill("101");
  await page.getByRole("button", { name: "Save skill" }).click();

  await expect(
    page.getByText("Enter a whole number between 0 and 100."),
  ).toBeVisible();
  await expect(page.getByText("Added Linux.")).toHaveCount(0);

  await gotoApp(page, "/app/profile");
  await expect(
    page.getByText("You have not added any skills yet."),
  ).toBeVisible();
});

test("adds an interest, persists it, does not duplicate, then removes it", async ({
  page,
}) => {
  await prepareOnboardedUser(page, "interest-assign");

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("heading", { name: "Interests" })).toBeVisible();
  await expect(
    page.getByText("You have not added any interests yet."),
  ).toBeVisible();

  await page
    .getByLabel("Add an interest")
    .selectOption({ label: "Open Source" });
  await page.getByRole("button", { name: "Add interest" }).click();

  await expect(page.getByText("Open Source added.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  // Adding the same interest again is idempotent, not an error.
  await page
    .getByLabel("Add an interest")
    .selectOption({ label: "Open Source" });
  await page.getByRole("button", { name: "Add interest" }).click();
  await expect(page.getByText("Open Source added.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Remove Open Source" }).click();
  await expect(page.getByText("Interest removed.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(
    page.getByText("You have not added any interests yet."),
  ).toBeVisible();
});

test("keeps skills and interests independent and both editable", async ({
  page,
}) => {
  await prepareOnboardedUser(page, "taxonomy-both");

  await gotoApp(page, "/app/profile");

  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "React" });
  await page.getByLabel("Proficiency").selectOption("EXPERT");
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page.getByText("Added React.")).toBeVisible();

  await page
    .getByLabel("Add an interest")
    .selectOption({ label: "Open Source" });
  await page.getByRole("button", { name: "Add interest" }).click();
  await expect(page.getByText("Open Source added.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Expert" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Open Source" }),
  ).toHaveCount(1);

  // Removing the skill leaves the interest alone.
  await page.getByRole("button", { name: "Remove React" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  await gotoApp(page, "/app/profile");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByText("You have not added any skills yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Open Source" }),
  ).toBeVisible();
});

test("still edits the own profile on the same page", async ({ page }) => {
  const identity = await prepareOnboardedUser(page, "both-sections");

  await gotoApp(page, "/app/profile");
  await page.getByLabel("Display name").fill("Ada King");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  await page
    .getByLabel("Add or update a skill")
    .selectOption({ label: "React" });
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page.getByText("Added React.")).toBeVisible();

  await gotoApp(page, "/app/profile");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada King");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  expect(identity.email).toBeTruthy();
});

test("offers no way to create or edit taxonomy", async ({ page }) => {
  await prepareOnboardedUser(page, "no-taxonomy-edit");

  await gotoApp(page, "/app/profile");

  for (const name of ["name", "slug", "nameKey", "category", "userId"]) {
    await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
  }

  await expect(
    page.getByRole("button", { name: /create skill|add your own|new skill/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /create interest|add your own|new interest/i,
    }),
  ).toHaveCount(0);
});

test("keeps taxonomy sections unreachable before onboarding", async ({
  page,
}) => {
  const identity = uniqueIdentity("taxonomy-incomplete");

  await signUpThroughUi(page, identity);
  await gotoApp(page, await waitForAuthLink("verification", identity.email));
  await expect(page).toHaveURL(/verified=1/);

  await signInThroughUi(page, identity);
  await expect(page).toHaveURL(/\/onboarding/);

  await gotoApp(page, "/app/profile");
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByLabel("Add or update a skill")).toHaveCount(0);
  await expect(page.getByLabel("Add an interest")).toHaveCount(0);
});
