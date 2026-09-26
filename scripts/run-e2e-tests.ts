import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import "dotenv/config";

import { spawnSync } from "node:child_process";

import {
  assertSafeE2EDatabaseEnvironment,
  E2E_DATABASE_CONTEXT_ENV,
  E2E_DATABASE_CONTEXT_VALUE,
} from "./test-database-guard";

/**
 * Guarded end-to-end runner.
 *
 * Mirrors `run-auth-integration-tests.ts`: the guard runs in this process, then
 * the application is spawned with `DATABASE_URL` pointed at the guarded test
 * database so the app process cannot reach the development database.
 *
 * Only `prisma migrate deploy` is used. Nothing here resets, pushes, drops, or
 * otherwise mutates a schema.
 */

const E2E_PORT = process.env.E2E_PORT ?? "3100";
// Must match the Playwright base URL. Next.js 16 blocks cross-origin access to
// its dev resources, so an IP address here would prevent client hydration.
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

// The guard must see a non-production, explicitly marked context. The real
// development database is captured under its own name first, because the run
// repoints `DATABASE_URL` at the test database for the application process.
Object.assign(process.env, {
  NODE_ENV: "test",
  [E2E_DATABASE_CONTEXT_ENV]: E2E_DATABASE_CONTEXT_VALUE,
  DEVELOPMENT_DATABASE_URL: process.env.DATABASE_URL,
});

const { testDatabaseUrl } = assertSafeE2EDatabaseEnvironment(process.env);
console.log("End-to-end test database guard passed.");

const spawn = (command: string, args: string[]) =>
  command === "npm" || command === "npx"
    ? spawnSync(
        process.platform === "win32" ? `${command}.cmd` : command,
        args,
        {
          env: { ...process.env },
          stdio: "inherit",
          shell: process.platform === "win32",
        },
      )
    : spawnSync(command, args, {
        env: { ...process.env },
        stdio: "inherit",
      });

// Schema is brought up to date with an additive deploy against the test database.
const migration = spawn("npx", [
  "--no-install",
  "prisma",
  "migrate",
  "deploy",
  "--config",
  "prisma.e2e.config.ts",
]);

if (migration.error) {
  throw new Error("Unable to start the guarded Prisma migration command.");
}

if (migration.status !== 0) {
  process.exit(migration.status ?? 1);
}

// A fresh temp directory holds the token-bearing capture file. It is created
// per run, lives outside the repository, and is removed on completion or on an
// interrupt so live auth tokens are not left behind.
const captureDirectory = mkdtempSync(path.join(tmpdir(), "teammate-e2e-"));
const capturePath = path.join(captureDirectory, "auth-email-capture.jsonl");
writeFileSync(capturePath, "", "utf8");

let captureRemoved = false;
function removeCaptureDirectory(): void {
  if (captureRemoved) {
    return;
  }

  captureRemoved = true;
  rmSync(captureDirectory, { force: true, recursive: true });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    removeCaptureDirectory();
    process.exit(130);
  });
}

process.on("exit", removeCaptureDirectory);

// Non-secret, locally derived test secret. It satisfies the auth environment
// contract without being a real credential.
const testSecret = createHash("sha256")
  .update("teammate-e2e-local-test-secret")
  .digest("hex");

// The application process is isolated from the development database and from
// any production email provider.
const appEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
  DEVELOPMENT_DATABASE_URL: process.env.DEVELOPMENT_DATABASE_URL,
  NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
  BETTER_AUTH_URL: E2E_BASE_URL,
  BETTER_AUTH_SECRET: testSecret,
  [E2E_DATABASE_CONTEXT_ENV]: E2E_DATABASE_CONTEXT_VALUE,
  E2E_EMAIL_CAPTURE_PATH: capturePath,
  E2E_PORT,
  PORT: E2E_PORT,
  // Stripped so a developer's real credentials cannot reach the test app. This
  // is defense in depth, not the primary control: the transport selector only
  // chooses Resend when NODE_ENV is "production", and this app runs in
  // development mode, so no run can reach the provider regardless.
  RESEND_API_KEY: undefined,
  AUTH_EMAIL_FROM_ADDRESS: undefined,
};

const tests = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--no-install", "playwright", "test"],
  {
    env: appEnvironment,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (tests.error) {
  removeCaptureDirectory();
  throw new Error("Unable to start the end-to-end test command.");
}

removeCaptureDirectory();
process.exit(tests.status ?? 1);
