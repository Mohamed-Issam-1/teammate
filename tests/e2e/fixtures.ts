import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { expect, test as base, type Page } from "@playwright/test";

/**
 * End-to-end fixtures.
 *
 * Two boundaries matter here:
 *
 * 1. Database isolation. The runner already proved `TEST_DATABASE_URL` ends in
 *    `_test` and differs from `DATABASE_URL`. The reset helper re-proves both
 *    before deleting rows, and the application process is spawned with
 *    `DATABASE_URL` pointed at the test database, so neither the harness nor the
 *    app can reach the development database.
 *
 * 2. Email capture. Messages are read from the token-bearing capture file the
 *    application wrote, never from a debug route, an API response, or a log.
 */

/**
 * Prove this process is pointed at the guarded test database.
 *
 * The runner repoints `DATABASE_URL` at the test database before Playwright
 * starts. Asserting it here as well means an out-of-band `npx playwright test`
 * cannot quietly boot the application against the development database.
 */
function assertE2EEnvironment(): void {
  const testUrl = process.env.TEST_DATABASE_URL;

  if (typeof testUrl !== "string" || !testUrl.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must name a database ending in _test.");
  }

  if (process.env.DATABASE_URL !== testUrl) {
    throw new Error(
      "DATABASE_URL must equal TEST_DATABASE_URL for an end-to-end run. Use `npm run test:e2e`.",
    );
  }

  if (typeof process.env.DEVELOPMENT_DATABASE_URL !== "string") {
    throw new Error(
      "DEVELOPMENT_DATABASE_URL is required so the database guard can prove isolation.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("End-to-end tests must not run with NODE_ENV=production.");
  }
}

function assertCapturePath(): string {
  const value = process.env.E2E_EMAIL_CAPTURE_PATH;

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("E2E_EMAIL_CAPTURE_PATH is required for end-to-end tests.");
  }

  return value;
}

assertE2EEnvironment();
const capturePath = assertCapturePath();

/**
 * Clear database state for one test.
 *
 * Runs out of process because the Playwright worker emits CommonJS and cannot
 * require the ESM-only generated Prisma client.
 */
function resetDatabaseState(): void {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--no-install", "tsx", "scripts/reset-e2e-database.ts"],
    {
      env: { ...process.env },
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `End-to-end database reset failed: ${result.stderr ?? result.stdout ?? ""}`,
    );
  }
}

export type CapturedKind = "verification" | "password-reset";

export type CapturedMessage = {
  kind: CapturedKind;
  to: string;
  url: string;
};

let identityCounter = 0;

/** A unique identity per call so parallel or repeated runs never collide. */
export function uniqueIdentity(prefix: string) {
  identityCounter += 1;
  const stamp = `${Date.now().toString(36)}${identityCounter}`;

  return {
    name: `E2E ${prefix}`,
    email: `e2e-${prefix}-${stamp}@teammate-e2e.example`,
    password: "E2E-Correct-Horse-Battery-42",
  };
}

function readCaptured(kind: CapturedKind): CapturedMessage[] {
  let contents = "";
  try {
    contents = readFileSync(capturePath, "utf8");
  } catch {
    return [];
  }

  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CapturedMessage)
    .filter((message) => message.kind === kind);
}

/**
 * Wait for a message addressed to `email` and return its link.
 *
 * Only the caller knows the address it just submitted, so the capture file is
 * not a mailbox that could leak another user's token.
 */
export async function waitForAuthLink(
  kind: CapturedKind,
  email: string,
): Promise<string> {
  await expect
    .poll(
      () => readCaptured(kind).filter((message) => message.to === email).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  const message = readCaptured(kind)
    .filter((candidate) => candidate.to === email)
    .at(-1);

  if (!message) {
    throw new Error(
      "Expected a captured auth email for the submitted address.",
    );
  }

  return message.url;
}

export const test = base.extend<{ resetDatabase: void }>({
  resetDatabase: [
    async ({}, use) => {
      resetDatabaseState();
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Navigate and wait until the client bundle has hydrated.
 *
 * The suite runs against `next dev`, where the first request to a route triggers
 * an on-demand compile and the React handlers attach after load. Interacting
 * before hydration would fall through to a native form submit and silently
 * reload the page, so readiness is awaited explicitly.
 */
export async function gotoApp(page: Page, routePath: string): Promise<void> {
  await page.goto(routePath);
  await page.waitForLoadState("networkidle");
}

/**
 * Sign up through the real form and land on the verification-required state.
 *
 * The assertion targets the destination route and its neutral copy rather than
 * the transient panel rendered by the sign-up form, which the client-side
 * navigation immediately replaces.
 */
export async function signUpThroughUi(
  page: Page,
  identity: { name: string; email: string; password: string },
): Promise<void> {
  await gotoApp(page, "/sign-up");
  await page.getByLabel("Full name").fill(identity.name);
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByLabel("Confirm password").fill(identity.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/verify-email/);
  await expect(
    page.getByText("Check your email for a verification link", {
      exact: false,
    }),
  ).toBeVisible();
}

export async function signInThroughUi(
  page: Page,
  identity: { email: string; password: string },
): Promise<void> {
  await gotoApp(page, "/sign-in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
