import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * The suite drives the real application against the guarded `teammate_test`
 * database, using the filesystem E2E email capture transport instead of any
 * provider. No production URL, credential, or network provider is involved.
 *
 * The web server runs `next dev` deliberately. The E2E email capture boundary
 * refuses to activate in `NODE_ENV === "production"`, so a `next start`
 * production-mode server could never expose a token-bearing capture file. Using
 * development mode makes "test-only code is unreachable in production" a
 * structural property rather than an environment convention.
 */
/**
 * The port is validated before use because the web server command is spawned
 * through a shell, and an unvalidated value would be interpolated into it.
 */
function readE2EPort(): number {
  const raw = process.env.E2E_PORT ?? "3100";

  if (!/^\d{1,5}$/.test(raw)) {
    throw new Error("E2E_PORT must be a numeric port between 1 and 65535.");
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("E2E_PORT must be a numeric port between 1 and 65535.");
  }

  return port;
}

const E2E_PORT = readE2EPort();

/**
 * The base URL deliberately uses `localhost` rather than `127.0.0.1`.
 *
 * Next.js 16 blocks cross-origin access to its own dev resources. Requesting the
 * same dev server by IP address trips that guard, the React bundle never
 * hydrates, and every form silently falls through to a native submit.
 *
 * The server is bound to the `localhost` host so the run is not reachable from
 * other machines on the network. That matters because the end-to-end auth secret
 * is a deterministic local value, so anyone who could reach this port could mint
 * a valid session cookie for the test database.
 */
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  // Serial execution keeps database and email-capture state deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT} --hostname localhost`,
    url: `${E2E_BASE_URL}/sign-in`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
