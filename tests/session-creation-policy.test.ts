import { describe, expect, it } from "vitest";

import { APIError } from "better-auth/api";

import {
  createAuthOptions,
  requireActiveUserForSessionCreation,
} from "@/server/auth/options";

const noopEmailOperation = async (): Promise<void> => {};

async function expectGenericCreationFailure(promise: Promise<void>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(APIError);
  const apiError = error as APIError;
  expect(apiError.statusCode).toBe(403);
  expect(apiError.body).toMatchObject({
    code: "SESSION_CREATION_NOT_ALLOWED",
    message: "Session could not be created.",
  });
  expect(JSON.stringify(apiError)).not.toMatch(
    /suspend|accountStatus|prisma|postgres|constraint/i,
  );

  return apiError;
}

describe("session creation account-status policy", () => {
  it("allows a resolved user only when accountStatus is exactly ACTIVE", async () => {
    await expect(
      requireActiveUserForSessionCreation("user-id", async () => ({
        id: "user-id",
        accountStatus: "ACTIVE",
      })),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["a missing user", null],
    ["a missing status", { id: "user-id" }],
    ["an undefined status", { id: "user-id", accountStatus: undefined }],
    ["a suspended user", { id: "user-id", accountStatus: "SUSPENDED" }],
    ["an unknown status", { id: "user-id", accountStatus: "PENDING" }],
  ])("blocks session creation for %s", async (_case, user) => {
    await expectGenericCreationFailure(
      requireActiveUserForSessionCreation("user-id", async () => user),
    );
  });

  it("blocks session creation when the authoritative lookup fails", async () => {
    const rawDatabaseError = new Error(
      "Prisma database lookup failed: postgresql://secret@localhost/db",
    );

    await expectGenericCreationFailure(
      requireActiveUserForSessionCreation("user-id", async () => {
        throw rawDatabaseError;
      }),
    );
  });

  it("fails closed when Better Auth supplies no endpoint context", async () => {
    const beforeHook = createAuthOptions({
      baseURL: "http://localhost:3000",
      email: {
        sendVerificationEmail: noopEmailOperation,
        sendPasswordResetEmail: noopEmailOperation,
      },
    }).databaseHooks?.session?.create?.before;

    expect(beforeHook).toBeTypeOf("function");
    if (!beforeHook) {
      throw new Error("Expected the Better Auth session-create hook");
    }

    const session = { userId: "missing-user" } as Parameters<
      typeof beforeHook
    >[0];
    await expectGenericCreationFailure(beforeHook(session, null));
  });
});
