import { appendFileSync } from "node:fs";
import path from "node:path";

import type { AuthEmailOperations } from "@/server/auth/options";

/**
 * Test-only end-to-end email capture.
 *
 * A Playwright run drives the real application in a separate process, so the
 * in-memory development mailbox is not observable from the test process. This
 * transport records each message as one JSON line in an operator-supplied file
 * so the E2E harness can read a verification or reset link.
 *
 * It is deliberately narrow and guarded:
 *
 * - It is never returned from any production-mode process, because the selector
 *   refuses `NODE_ENV === "production"` outright.
 * - It activates only with an explicit E2E context marker, so it is also
 *   unreachable from an ordinary `npm run dev` session.
 * - It exposes no HTTP route, no framework integration, and no browser-reachable
 *   surface of any kind. The capture file is the only access path.
 * - It never logs a recipient, URL, or token, and it fails closed rather than
 *   silently dropping a message when the capture file is unusable.
 *
 * The capture file contains live auth tokens, so it must live in a throwaway
 * location such as the OS temp directory and must never be committed.
 */

export const E2E_EMAIL_CONTEXT_ENV = "E2E_TEST_CONTEXT";
export const E2E_EMAIL_CONTEXT_VALUE = "teammate-e2e";
export const E2E_EMAIL_CAPTURE_PATH_ENV = "E2E_EMAIL_CAPTURE_PATH";

export type E2ECapturedEmailKind = "verification" | "password-reset";

export type E2ECapturedEmail = {
  kind: E2ECapturedEmailKind;
  to: string;
  url: string;
  capturedAt: string;
};

type E2EEmailEnvironment = Record<string, string | undefined>;

function fail(message: string): never {
  throw new Error(`Unsafe end-to-end email capture configuration: ${message}`);
}

/**
 * Require an absolute path outside the repository working tree.
 *
 * A relative path would resolve against whatever directory the server happened
 * to start in, and a path inside the repository would place live auth tokens in
 * a file that could be staged or committed by accident. The capture file must
 * therefore live in a throwaway location such as the OS temp directory.
 */
function assertSafeCapturePath(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      `${E2E_EMAIL_CAPTURE_PATH_ENV} is required as an explicit absolute path`,
    );
  }

  const isAbsolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
  if (!isAbsolute) {
    fail(`${E2E_EMAIL_CAPTURE_PATH_ENV} must be an absolute path`);
  }

  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    fail(`${E2E_EMAIL_CAPTURE_PATH_ENV} must not contain control characters`);
  }

  if (isInsideRepository(value)) {
    fail(`${E2E_EMAIL_CAPTURE_PATH_ENV} must be outside the repository`);
  }

  return value;
}

/** True when `candidate` is the working tree or anything beneath it. */
function isInsideRepository(candidate: string): boolean {
  const repositoryRoot = path.resolve(process.cwd());
  const relative = path.relative(repositoryRoot, path.resolve(candidate));

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Resolve the capture transport, or `null` when this is not an E2E process.
 *
 * Returning `null` keeps the boundary inert everywhere else, including normal
 * local development. When the marker is present but the path is missing or
 * unsafe, this fails loudly rather than degrading to a mailbox that silently
 * discards messages.
 */
export function createE2EAuthEmailTransport(
  environment: E2EEmailEnvironment,
): FileSystemE2EEmailTransport | null {
  if (environment[E2E_EMAIL_CONTEXT_ENV] !== E2E_EMAIL_CONTEXT_VALUE) {
    return null;
  }

  if (environment.NODE_ENV === "production") {
    fail("NODE_ENV must not be production");
  }

  return new FileSystemE2EEmailTransport(
    assertSafeCapturePath(environment[E2E_EMAIL_CAPTURE_PATH_ENV]),
  );
}

export class FileSystemE2EEmailTransport implements AuthEmailOperations {
  readonly #capturePath: string;

  constructor(capturePath: string) {
    this.#capturePath = capturePath;
  }

  async sendVerificationEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#record("verification", input);
  }

  async sendPasswordResetEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#record("password-reset", input);
  }

  #record(
    kind: E2ECapturedEmailKind,
    input: Pick<E2ECapturedEmail, "to" | "url">,
  ): void {
    const record: E2ECapturedEmail = {
      kind,
      to: input.to,
      url: input.url,
      capturedAt: new Date().toISOString(),
    };

    try {
      appendFileSync(this.#capturePath, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Fail closed with a fixed message: never echo the path or the message.
      throw new Error("End-to-end email capture could not record a message.");
    }
  }
}
