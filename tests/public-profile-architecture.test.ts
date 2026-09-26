import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Architectural guards for the public profile route.
 *
 * Some of the requirements in this checkpoint are not observable from a unit test
 * of behavior: a viewer-dependent page can be correct and still leak across users
 * if someone later wraps it in a shared cache, and metadata can leak a display
 * name without any assertion failing. These checks read the source so a later
 * change cannot quietly reintroduce either problem.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");

function sourceFilesUnder(relativeDirectory: string): string[] {
  const root = path.join(repoRoot, relativeDirectory);
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(full)) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found;
}

const routeFiles = [
  "src/app/profiles/[userId]/page.tsx",
  "src/server/profiles/visible-profile.ts",
  "src/server/profiles/current-viewer.ts",
  "src/features/profile/components/public-profile-view.tsx",
];

describe("public profile caching posture", () => {
  it("uses no shared-cache primitive around a viewer-dependent read", () => {
    for (const [label, pattern] of [
      ["unstable_cache", /unstable_cache/],
      ["revalidateTag", /revalidateTag/],
      ["use cache directive", /["']use cache["']/],
      ["cacheLife", /cacheLife/],
      ["cacheTag", /cacheTag/],
      ["generateStaticParams", /generateStaticParams/],
      ["force-static", /force-static/],
      ["force-dynamic", /force-dynamic/],
      ["dynamicParams", /dynamicParams/],
      ["fetchCache config", /export const fetchCache/],
    ] as const) {
      for (const file of routeFiles) {
        const source = readFileSync(path.join(repoRoot, file), "utf8");
        expect(source, `${label} in ${file}`).not.toMatch(pattern);
      }
    }
  });

  it("exports no static-render opt-out that would enable full-route caching", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/app/profiles/[userId]/page.tsx"),
      "utf8",
    );

    // `revalidate` or a `dynamic` export on a viewer-dependent page is the way a
    // cached variant would be introduced. Reading `headers()` inside the session
    // helper already forces dynamic rendering, and the build confirms the route
    // is reported as dynamic.
    expect(source).not.toMatch(/export const revalidate/);
    expect(source).not.toMatch(/export const dynamic/);
  });

  it("resolves the viewer through the request headers, forcing a per-request read", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/server/profiles/current-viewer.ts"),
      "utf8",
    );

    expect(source).toContain("getServerSession");
  });
});

describe("public profile read-only posture", () => {
  it("contains no Prisma write or raw-SQL call anywhere under the profile route", () => {
    // Bracket access is included so `database["user"].update(...)` cannot slip
    // past, and the raw-SQL methods are listed because a read-only contract must
    // exclude them too.
    const forbidden =
      /[.["']\s*(create|createMany|update|updateMany|upsert|delete|deleteMany|\$queryRaw|\$queryRawUnsafe|\$executeRaw|\$executeRawUnsafe)\s*[([]/;

    for (const file of routeFiles) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      expect(source, file).not.toMatch(forbidden);
    }
  });

  it("narrows the database contract to a single read method", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/server/profiles/visible-profile.ts"),
      "utf8",
    );

    // Pinned precisely so the guarantee is structural. Picking the whole
    // `user` delegate would still permit `update`, `deleteMany`, and every
    // `$queryRaw*` variant, so the type has to name the method.
    expect(source).toMatch(
      /user:\s*Pick<PrismaClient\["user"\],\s*"findUnique">/,
    );
    expect(source).not.toMatch(/Pick<PrismaClient,\s*"user">/);
  });

  it("adds no server action or route handler for the public profile", () => {
    const newRouteFiles = sourceFilesUnder("src/app/profiles");

    expect(newRouteFiles).toHaveLength(1);
    expect(newRouteFiles[0]).toContain("page.tsx");
  });

  it("does not mark the public route as a client component", () => {
    for (const file of routeFiles) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      expect(source, file).not.toMatch(/^"use client"/m);
    }
  });
});

describe("public profile projection posture", () => {
  it("never selects a column that is not needed even for authorization", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/server/profiles/visible-profile.ts"),
      "utf8",
    );

    // These are never required to decide access, so selecting them at all would
    // be loading private data for no reason.
    for (const forbidden of [
      "yearsExperience: true",
      "timezone: true",
      "availabilityHoursPerWeek: true",
      "nameKey: true",
      "email: true",
      "globalRole: true",
      "createdAt: true",
      "updatedAt: true",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("reads target eligibility columns without letting them into the projection", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/server/profiles/visible-profile.ts"),
      "utf8",
    );

    // The authorization query is *supposed* to read these: a suspended or
    // unverified target must be detected in order to be denied. The requirement
    // is that they stay inside the boundary, so the exported projection type
    // must not mention them.
    expect(source).toContain("accountStatus: true");
    expect(source).toContain("emailVerified: true");
    expect(source).toContain("onboardingCompletedAt: true");

    const projectionType = source.slice(
      source.indexOf("export type VisibleProfile = {"),
      source.indexOf("export type VisibleInterest"),
    );

    for (const forbidden of [
      "accountStatus",
      "emailVerified",
      "onboardingCompletedAt",
      "profileVisibility",
      "userId",
    ]) {
      expect(projectionType, forbidden).not.toContain(forbidden);
    }
  });

  it("does not widen the database contract beyond reads", () => {
    const source = readFileSync(
      path.join(repoRoot, "src/server/profiles/visible-profile.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /user:\s*Pick<PrismaClient\["user"\], "findUnique">/,
    );
  });
});
