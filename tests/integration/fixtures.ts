import { createHash } from "node:crypto";

import { applySetCookies, splitSetCookieHeader } from "better-auth/cookies";

import { assertSafeTestDatabaseEnvironment } from "../../scripts/test-database-guard";
import { createAuth } from "../../src/server/auth/factory";
import type { AuthEmailOperations } from "../../src/server/auth/options";
import { createPrismaClient } from "../../src/server/db/client";

export const TEST_AUTH_BASE_URL = "http://localhost:3000";

export type CapturedAuthEmail = {
  id: string;
  kind: "verification" | "password-reset";
  to: string;
  url: string;
  createdAt: Date;
};

export class TestAuthEmailTransport implements AuthEmailOperations {
  readonly #messages: CapturedAuthEmail[] = [];

  async sendVerificationEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#messages.push({
      id: crypto.randomUUID(),
      kind: "verification",
      to: input.to,
      url: input.url,
      createdAt: new Date(),
    });
  }

  async sendPasswordResetEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#messages.push({
      id: crypto.randomUUID(),
      kind: "password-reset",
      to: input.to,
      url: input.url,
      createdAt: new Date(),
    });
  }

  takeAll(): CapturedAuthEmail[] {
    return this.#messages.splice(0);
  }

  clear(): void {
    this.#messages.length = 0;
  }
}

export class TestCookieJar {
  readonly #headers = new Headers();

  capture(headers: Headers): void {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : splitSetCookieHeader(headers.get("set-cookie") ?? "");

    applySetCookies(this.#headers, values);
  }

  headers(): Headers {
    return new Headers(this.#headers);
  }

  clear(): void {
    this.#headers.delete("cookie");
  }
}

const { testDatabaseUrl } = assertSafeTestDatabaseEnvironment(process.env);

export const testPrisma = createPrismaClient(testDatabaseUrl);
export const testEmail = new TestAuthEmailTransport();
export const testAuth = createAuth({
  baseURL: TEST_AUTH_BASE_URL,
  database: testPrisma,
  email: testEmail,
  secret: createHash("sha256")
    .update("teammate-auth-core-integration-test")
    .digest("hex"),
});

export async function resetTestDatabase(): Promise<void> {
  testEmail.clear();

  // Join rows and shared taxonomy are removed explicitly. Deleting a user would
  // cascade the join rows anyway, but taxonomy rows are global and reference-
  // restricted, so they must be cleared deliberately and in dependency order.
  await testPrisma.$transaction([
    testPrisma.rateLimit.deleteMany(),
    testPrisma.session.deleteMany(),
    testPrisma.account.deleteMany(),
    testPrisma.verification.deleteMany(),
    testPrisma.userSkill.deleteMany(),
    testPrisma.userInterest.deleteMany(),
    testPrisma.profile.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.skill.deleteMany(),
    testPrisma.interest.deleteMany(),
  ]);
}
