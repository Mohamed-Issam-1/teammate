import { describe, expect, it } from "vitest";

import {
  assertSafeE2EDatabaseEnvironment,
  E2E_DATABASE_CONTEXT_ENV,
  E2E_DATABASE_CONTEXT_VALUE,
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
    DEVELOPMENT_DATABASE_URL: DEVELOPMENT_URL,
    TEST_DATABASE_URL: TEST_URL,
    [E2E_DATABASE_CONTEXT_ENV]: E2E_DATABASE_CONTEXT_VALUE,
    ...overrides,
  };
}

function validationError(
  candidate: Record<string, string | undefined>,
): string {
  try {
    assertSafeE2EDatabaseEnvironment(candidate);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the end-to-end guard to reject the configuration");
}

describe("assertSafeE2EDatabaseEnvironment", () => {
  it("accepts an explicit development to teammate_test target", () => {
    expect(assertSafeE2EDatabaseEnvironment(environment())).toEqual({
      testDatabaseUrl: TEST_URL,
    });
  });

  it("accepts development mode, because the suite runs the app that way", () => {
    expect(
      assertSafeE2EDatabaseEnvironment(
        environment({ NODE_ENV: "development" }),
      ),
    ).toEqual({ testDatabaseUrl: TEST_URL });
  });

  it("refuses a production-mode process outright", () => {
    expect(validationError(environment({ NODE_ENV: "production" }))).toContain(
      "must not be production",
    );
  });

  it("requires the explicit E2E context marker", () => {
    expect(
      validationError(environment({ [E2E_DATABASE_CONTEXT_ENV]: undefined })),
    ).toContain(E2E_DATABASE_CONTEXT_ENV);
    expect(
      validationError(environment({ [E2E_DATABASE_CONTEXT_ENV]: "nope" })),
    ).toContain(E2E_DATABASE_CONTEXT_ENV);
  });

  it("refuses to be satisfied by the integration marker alone", () => {
    // The integration marker is rejected first, which is stricter than merely
    // demanding the E2E marker.
    expect(
      validationError(
        environment({
          [E2E_DATABASE_CONTEXT_ENV]: undefined,
          [TEST_DATABASE_CONTEXT_ENV]: TEST_DATABASE_CONTEXT_VALUE,
        }),
      ),
    ).toContain(TEST_DATABASE_CONTEXT_ENV);
  });

  it("rejects the integration marker being used for an end-to-end run", () => {
    expect(
      validationError(
        environment({
          [TEST_DATABASE_CONTEXT_ENV]: TEST_DATABASE_CONTEXT_VALUE,
        }),
      ),
    ).toContain(TEST_DATABASE_CONTEXT_ENV);
  });

  it("requires both database URLs to be explicit", () => {
    expect(
      validationError(environment({ TEST_DATABASE_URL: undefined })),
    ).toContain("TEST_DATABASE_URL");
    expect(
      validationError(environment({ DEVELOPMENT_DATABASE_URL: undefined })),
    ).toContain("DEVELOPMENT_DATABASE_URL");
    expect(validationError(environment({ TEST_DATABASE_URL: "" }))).toContain(
      "TEST_DATABASE_URL",
    );
  });

  it("rejects a test database that does not end in _test", () => {
    expect(
      validationError(
        environment({
          TEST_DATABASE_URL:
            "postgresql://teammate:test@localhost:5432/teammate",
        }),
      ),
    ).toContain("must end in _test");
  });

  it("rejects a test database equal to the development database", () => {
    expect(
      validationError(environment({ TEST_DATABASE_URL: DEVELOPMENT_URL })),
    ).toContain("must end in _test");
  });

  it("rejects a mismatched host, port, or non-simple URL", () => {
    expect(
      validationError(
        environment({
          TEST_DATABASE_URL:
            "postgresql://teammate:test@otherhost:5432/teammate_test",
        }),
      ),
    ).toContain("hostnames must match");
    // A non-5432 explicit port is refused during URL shape parsing.
    expect(
      validationError(
        environment({
          TEST_DATABASE_URL:
            "postgresql://teammate:test@localhost:6000/teammate_test",
        }),
      ),
    ).toContain("5432");
    expect(
      validationError(
        environment({
          TEST_DATABASE_URL:
            "postgresql://teammate:test@localhost:5432/teammate_test?schema=public",
        }),
      ),
    ).toContain("TEST_DATABASE_URL");
  });

  it("never echoes a connection value in a failure", () => {
    // A shape violation forces a failure while the secret stays in the value.
    const message = validationError(
      environment({
        TEST_DATABASE_URL:
          "postgresql://teammate:sup3rsecret@localhost:5432/teammate_test?schema=public",
      }),
    );

    expect(message).toContain("TEST_DATABASE_URL");
    expect(message).not.toContain("sup3rsecret");
  });
});
