import "dotenv/config";

import { defineConfig } from "prisma/config";

import { assertSafeTestDatabaseEnvironment } from "./scripts/test-database-guard";

const { testDatabaseUrl } = assertSafeTestDatabaseEnvironment(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testDatabaseUrl,
  },
});
