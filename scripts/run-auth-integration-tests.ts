import "dotenv/config";

import { spawnSync } from "node:child_process";

import {
  assertSafeTestDatabaseEnvironment,
  TEST_DATABASE_CONTEXT_ENV,
  TEST_DATABASE_CONTEXT_VALUE,
} from "./test-database-guard";

Object.assign(process.env, {
  NODE_ENV: "test",
  [TEST_DATABASE_CONTEXT_ENV]: TEST_DATABASE_CONTEXT_VALUE,
});

assertSafeTestDatabaseEnvironment(process.env);
console.log("Integration test database guard passed.");

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const environment = { ...process.env };
const spawnOptions = {
  env: environment,
  stdio: "inherit" as const,
  shell: process.platform === "win32",
};

const migration = spawnSync(
  command,
  [
    "--no-install",
    "prisma",
    "migrate",
    "deploy",
    "--config",
    "prisma.test.config.ts",
  ],
  spawnOptions,
);

if (migration.error) {
  throw new Error("Unable to start the guarded Prisma migration command.");
}

if (migration.status !== 0) {
  process.exit(migration.status ?? 1);
}

const tests = spawnSync(
  command,
  [
    "--no-install",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.mts",
  ],
  spawnOptions,
);

if (tests.error) {
  throw new Error("Unable to start the guarded auth integration test command.");
}

process.exit(tests.status ?? 1);
