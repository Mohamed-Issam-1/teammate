import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEVELOPMENT_EMAIL_MAX_MESSAGES,
  DEVELOPMENT_EMAIL_TTL_MS,
  InMemoryDevelopmentEmailTransport,
} from "@/server/email/development";

async function findRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findRouteFiles(entryPath);
      }
      return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
    }),
  );

  return nestedFiles.flat();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InMemoryDevelopmentEmailTransport", () => {
  it("uses conservative development capacity and TTL defaults", () => {
    expect(DEVELOPMENT_EMAIL_MAX_MESSAGES).toBe(50);
    expect(DEVELOPMENT_EMAIL_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("drops the oldest messages when bounded capacity is exceeded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transport = new InMemoryDevelopmentEmailTransport({
      maxMessages: 2,
      now: () => 1_000,
    });

    await transport.sendVerificationEmail({
      to: "one@example.com",
      url: "https://example.test/verify?token=one",
    });
    await transport.sendPasswordResetEmail({
      to: "two@example.com",
      url: "https://example.test/reset/one",
    });
    await transport.sendVerificationEmail({
      to: "three@example.com",
      url: "https://example.test/verify?token=three",
    });

    expect(transport.takeAll().map((message) => message.to)).toEqual([
      "two@example.com",
      "three@example.com",
    ]);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("prunes messages on read when their TTL has elapsed", async () => {
    let now = 1_000;
    const transport = new InMemoryDevelopmentEmailTransport({
      now: () => now,
      ttlMs: 500,
    });

    await transport.sendVerificationEmail({
      to: "expiring@example.com",
      url: "https://example.test/verify?token=expiring",
    });
    now += 500;

    expect(transport.takeAll()).toEqual([]);
  });

  it("prunes expired messages before retaining a new write", async () => {
    let now = 1_000;
    const transport = new InMemoryDevelopmentEmailTransport({
      now: () => now,
      ttlMs: 500,
    });

    await transport.sendVerificationEmail({
      to: "expired@example.com",
      url: "https://example.test/verify?token=expired",
    });
    now += 501;
    await transport.sendPasswordResetEmail({
      to: "current@example.com",
      url: "https://example.test/reset/current",
    });

    expect(transport.takeAll().map((message) => message.to)).toEqual([
      "current@example.com",
    ]);
  });

  it("has no mailbox or development-transport application route", async () => {
    const appDirectory = path.resolve(process.cwd(), "src", "app");
    const routeFiles = await findRouteFiles(appDirectory);

    expect(routeFiles.length).toBeGreaterThan(0);
    expect(
      routeFiles.filter((routeFile) =>
        /mailbox|development-email/i.test(routeFile),
      ),
    ).toEqual([]);

    for (const routeFile of routeFiles) {
      const source = await readFile(routeFile, "utf8");
      expect(source).not.toMatch(
        /InMemoryDevelopmentEmailTransport|authEmail|takeAll\(/,
      );
    }
  });
});
