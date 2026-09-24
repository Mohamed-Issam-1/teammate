import { describe, expect, it } from "vitest";

import {
  assertSafeTestDatabaseEnvironment,
  TEST_DATABASE_CONTEXT_ENV,
  TEST_DATABASE_CONTEXT_VALUE,
} from "../scripts/test-database-guard";

const DEVELOPMENT_URL = "postgresql://teammate:dev@localhost:5432/teammate";
const TEST_URL = "postgresql://teammate:test@localhost:5432/teammate_test";

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: DEVELOPMENT_URL,
    TEST_DATABASE_URL: TEST_URL,
    [TEST_DATABASE_CONTEXT_ENV]: TEST_DATABASE_CONTEXT_VALUE,
    ...overrides,
  };
}

function validationError(
  candidate: Record<string, string | undefined>,
): string {
  try {
    assertSafeTestDatabaseEnvironment(candidate);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the database guard to reject the configuration");
}

describe("assertSafeTestDatabaseEnvironment", () => {
  it("accepts an explicit teammate to teammate_test target", () => {
    expect(assertSafeTestDatabaseEnvironment(environment())).toEqual({
      testDatabaseUrl: TEST_URL,
    });
  });

  it("accepts an omitted port only when its effective port is 5432", () => {
    expect(
      assertSafeTestDatabaseEnvironment(
        environment({
          DATABASE_URL: "postgres://teammate:dev@localhost/teammate",
          TEST_DATABASE_URL:
            "postgresql://teammate:test@localhost/teammate_test",
        }),
      ),
    ).toEqual({
      testDatabaseUrl: "postgresql://teammate:test@localhost/teammate_test",
    });
  });

  it("compares hostnames case-insensitively but without DNS alias resolution", () => {
    expect(
      assertSafeTestDatabaseEnvironment(
        environment({
          DATABASE_URL: "postgresql://teammate:dev@LOCALHOST:5432/teammate",
        }),
      ),
    ).toEqual({ testDatabaseUrl: TEST_URL });
  });

  it("requires NODE_ENV=test from the integration process", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ NODE_ENV: "development" }),
      ),
    ).toThrowError(/NODE_ENV must be exactly test/);
  });

  it("requires an explicit integration-test context", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ [TEST_DATABASE_CONTEXT_ENV]: "false" }),
      ),
    ).toThrowError(/AUTH_INTEGRATION_TEST_CONTEXT/);
  });

  it("requires TEST_DATABASE_URL to exist as its own environment value", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ TEST_DATABASE_URL: undefined }),
      ),
    ).toThrowError(/TEST_DATABASE_URL is required/);
  });

  it("never falls back to an inherited or prototype DATABASE_URL", () => {
    const inheritedEnvironment = Object.create({
      TEST_DATABASE_URL: TEST_URL,
    }) as Record<string, string | undefined>;
    inheritedEnvironment.NODE_ENV = "test";
    inheritedEnvironment.DATABASE_URL = DEVELOPMENT_URL;
    inheritedEnvironment[TEST_DATABASE_CONTEXT_ENV] =
      TEST_DATABASE_CONTEXT_VALUE;

    expect(() =>
      assertSafeTestDatabaseEnvironment(inheritedEnvironment),
    ).toThrowError(/TEST_DATABASE_URL is required/);
  });

  it("requires DATABASE_URL to exist as its own environment value", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ DATABASE_URL: undefined }),
      ),
    ).toThrowError(/DATABASE_URL is required/);
  });

  it.each([
    [
      "a generic query",
      "postgresql://teammate:test@localhost:5432/teammate_test?sslmode=disable",
    ],
    [
      "a host override",
      "postgresql://teammate:test@localhost:5432/teammate_test?host=127.0.0.1",
    ],
    [
      "a port override",
      "postgresql://teammate:test@localhost:5432/teammate_test?port=5433",
    ],
    [
      "a dbname override",
      "postgresql://teammate:test@localhost:5432/teammate_test?dbname=teammate",
    ],
  ])("rejects %s on TEST_DATABASE_URL", (_case, testUrl) => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ TEST_DATABASE_URL: testUrl }),
      ),
    ).toThrowError(/query or search parameters/);
  });

  it("applies the restricted query rules to DATABASE_URL as well", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({
          DATABASE_URL: `${DEVELOPMENT_URL}?host=127.0.0.1`,
        }),
      ),
    ).toThrowError(/query or search parameters/);
  });

  it.each([
    "postgresql://teammate:test@localhost:5432/teammate_test#fragment",
    "postgresql://teammate:test@localhost:5432/teammate_test#",
  ])("rejects URL fragments", (testUrl) => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ TEST_DATABASE_URL: testUrl }),
      ),
    ).toThrowError(/URL fragment/);
  });

  it("rejects a hostname alias mismatch without resolving it", () => {
    const testUrl = "postgresql://teammate:test@127.0.0.1:5432/teammate_test";

    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ TEST_DATABASE_URL: testUrl }),
      ),
    ).toThrowError(/hostnames must match exactly/);
  });

  it("compares raw IPv6 spelling instead of accepting URL-parser aliases", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({
          DATABASE_URL:
            "postgresql://teammate:dev@[0:0:0:0:0:0:0:1]:5432/teammate",
          TEST_DATABASE_URL:
            "postgresql://teammate:test@[::1]:5432/teammate_test",
        }),
      ),
    ).toThrowError(/hostnames must match exactly/);
  });

  it("rejects encoded or non-ASCII hostname spellings", () => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({
          TEST_DATABASE_URL:
            "postgresql://teammate:test@t%C3%A4st.example:5432/teammate_test",
        }),
      ),
    ).toThrowError(/literal hostname/);
  });

  it.each([
    "postgresql://teammate:test@localhost:5432/teammate%5Ftest",
    "postgresql://teammate:test@localhost:5432/%74eammate_test",
    "postgresql://teammate:test@localhost:5432/teammate_test%2Fother",
    "postgresql://teammate:test@localhost:5432/teammate_test/../teammate_test",
    "postgresql://teammate:test@localhost:5432/team/mate_test",
    "postgresql://teammate:test@localhost:5432//teammate_test",
    "postgresql://teammate:test@localhost:5432/teammate_test/",
    "postgresql://teammate:test@localhost:5432/teammate-test",
  ])(
    "rejects an encoded, malformed, or multi-segment database path",
    (testUrl) => {
      expect(() =>
        assertSafeTestDatabaseEnvironment(
          environment({ TEST_DATABASE_URL: testUrl }),
        ),
      ).toThrowError(/database path|database name/);
    },
  );

  it.each([
    "postgresql://teammate:test@localhost:5433/teammate_test",
    "postgresql://teammate:test@localhost:6432/teammate_test",
  ])("rejects a non-5432 effective port", (testUrl) => {
    expect(() =>
      assertSafeTestDatabaseEnvironment(
        environment({ TEST_DATABASE_URL: testUrl }),
      ),
    ).toThrowError(/port 5432/);
  });

  it("rejects the same database with different credentials", () => {
    const message = validationError(
      environment({
        DATABASE_URL:
          "postgresql://teammate:development-secret@localhost:5432/teammate_test",
        TEST_DATABASE_URL:
          "postgresql://other:test-secret@localhost:5432/teammate_test",
      }),
    );

    expect(message).toMatch(/database name different|different database/);
  });

  it("rejects the same database with different protocol spelling", () => {
    const message = validationError(
      environment({
        DATABASE_URL: "postgresql://teammate:dev@localhost:5432/teammate_test",
        TEST_DATABASE_URL:
          "postgres://teammate:test@localhost:5432/teammate_test",
      }),
    );

    expect(message).toMatch(/database name different|different database/);
  });

  it.each(["teammate", "teammate_TEST"])(
    "requires the exact lowercase _test suffix (%s)",
    (databaseName) => {
      expect(() =>
        assertSafeTestDatabaseEnvironment(
          environment({
            TEST_DATABASE_URL: `postgresql://teammate:test@localhost:5432/${databaseName}`,
          }),
        ),
      ).toThrowError(/must end in _test/);
    },
  );

  it.each([
    environment({
      TEST_DATABASE_URL:
        "postgresql://leaky-user:query-secret@localhost:5432/teammate_test?host=127.0.0.1",
    }),
    environment({
      TEST_DATABASE_URL:
        "postgresql://leaky-user:fragment-secret@localhost:5432/teammate_test#token",
    }),
    environment({
      TEST_DATABASE_URL:
        "postgresql://leaky-user:path-secret@localhost:5432/teammate%5Ftest",
    }),
    environment({
      TEST_DATABASE_URL:
        "postgresql://leaky-user:port-secret@localhost:5433/teammate_test",
    }),
  ])(
    "never exposes connection values or credentials in errors",
    (candidate) => {
      const message = validationError(candidate);

      expect(message).not.toMatch(/leaky-user|secret/i);
      expect(message).not.toContain(candidate.TEST_DATABASE_URL as string);
    },
  );
});
