// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createE2EAuthEmailTransport,
  E2E_EMAIL_CAPTURE_PATH_ENV,
  E2E_EMAIL_CONTEXT_ENV,
  E2E_EMAIL_CONTEXT_VALUE,
  FileSystemE2EEmailTransport,
} from "@/server/email/e2e";

const VERIFICATION_URL =
  "https://app.teammate.example/verify-email?token=abc123";
const RESET_URL = "https://app.teammate.example/reset-password/xyz789";
const RECIPIENT = "person@example.com";

const scratchDirectories: string[] = [];

function scratchFile(name = "capture.jsonl"): string {
  const directory = mkdtempSync(path.join(tmpdir(), "teammate-e2e-unit-"));
  scratchDirectories.push(directory);

  return path.join(directory, name);
}

function e2eEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    [E2E_EMAIL_CONTEXT_ENV]: E2E_EMAIL_CONTEXT_VALUE,
    NODE_ENV: "development",
    [E2E_EMAIL_CAPTURE_PATH_ENV]: scratchFile(),
    ...overrides,
  };
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

afterEach(() => {
  vi.restoreAllMocks();
  while (scratchDirectories.length > 0) {
    rmSync(scratchDirectories.pop() as string, {
      force: true,
      recursive: true,
    });
  }
});

describe("E2E email capture activation", () => {
  it("stays inert without the explicit E2E context marker", () => {
    expect(createE2EAuthEmailTransport({})).toBeNull();
    expect(createE2EAuthEmailTransport({ NODE_ENV: "development" })).toBeNull();
    expect(
      createE2EAuthEmailTransport({
        [E2E_EMAIL_CONTEXT_ENV]: "something-else",
        NODE_ENV: "development",
      }),
    ).toBeNull();
  });

  it("refuses to activate in a production-mode process", () => {
    expect(() =>
      createE2EAuthEmailTransport(e2eEnvironment({ NODE_ENV: "production" })),
    ).toThrowError(/must not be production/);
  });

  it("activates only for an explicitly marked non-production process", () => {
    const transport = createE2EAuthEmailTransport(e2eEnvironment());

    expect(transport).toBeInstanceOf(FileSystemE2EEmailTransport);
  });

  it("fails closed when the marker is present but the capture path is unusable", () => {
    for (const capturePath of [
      undefined,
      "",
      "relative/capture.jsonl",
      "a\nb",
    ]) {
      expect(() =>
        createE2EAuthEmailTransport(
          e2eEnvironment({ [E2E_EMAIL_CAPTURE_PATH_ENV]: capturePath }),
        ),
      ).toThrowError(/end-to-end email capture configuration/);
    }
  });

  it("rejects a capture path inside the repository", () => {
    // The capture file holds live auth tokens, so it must never be committable.
    for (const capturePath of [
      path.join(process.cwd(), "auth-email-capture.jsonl"),
      path.join(process.cwd(), "test-results", "capture.jsonl"),
      process.cwd(),
    ]) {
      expect(() =>
        createE2EAuthEmailTransport(
          e2eEnvironment({ [E2E_EMAIL_CAPTURE_PATH_ENV]: capturePath }),
        ),
      ).toThrowError(/must be outside the repository/);
    }
  });

  it("never includes the capture path or message content in a failure", () => {
    const capturePath = scratchFile();
    let thrown: unknown;

    try {
      createE2EAuthEmailTransport(
        e2eEnvironment({ [E2E_EMAIL_CAPTURE_PATH_ENV]: `${capturePath}\n` }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(String((thrown as Error)?.message)).not.toContain(capturePath);
  });
});

describe("FileSystemE2EEmailTransport", () => {
  it("records one JSON line per message and never logs", async () => {
    const capturePath = scratchFile();
    const consoleSpies = {
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    };
    const transport = new FileSystemE2EEmailTransport(capturePath);

    await transport.sendVerificationEmail({
      to: RECIPIENT,
      url: VERIFICATION_URL,
    });
    await transport.sendPasswordResetEmail({ to: RECIPIENT, url: RESET_URL });

    const records = readLines(capturePath).map(
      (line) => JSON.parse(line) as Record<string, string>,
    );

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: "verification",
      to: RECIPIENT,
      url: VERIFICATION_URL,
    });
    expect(records[1]).toMatchObject({
      kind: "password-reset",
      to: RECIPIENT,
      url: RESET_URL,
    });
    expect(typeof records[0]?.capturedAt).toBe("string");

    for (const spy of Object.values(consoleSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("fails closed with a fixed message when the capture file is unusable", async () => {
    const transport = new FileSystemE2EEmailTransport(
      path.join(tmpdir(), "teammate-e2e-missing-dir", "capture.jsonl"),
    );

    const error = await transport
      .sendVerificationEmail({ to: RECIPIENT, url: VERIFICATION_URL })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "End-to-end email capture could not record a message.",
    );
    expect((error as Error).message).not.toContain(RECIPIENT);
    expect((error as Error).message).not.toContain("token");
  });

  it("does not leak an earlier message when a later write fails", async () => {
    const capturePath = scratchFile();
    const transport = new FileSystemE2EEmailTransport(capturePath);

    await transport.sendVerificationEmail({
      to: RECIPIENT,
      url: VERIFICATION_URL,
    });
    writeFileSync(capturePath, "corrupted-not-json\n", "utf8");

    // A pre-existing corrupt line must not break subsequent reads by consumers
    // that tolerate it, and the transport must not rewrite history.
    expect(readLines(capturePath)).toEqual(["corrupted-not-json"]);
  });
});
