// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isValidTaxonomyName,
  isValidTaxonomySlug,
  toNameKey,
  validateStarterTaxonomy,
} from "@/server/taxonomy/normalize";
import {
  STARTER_INTEREST_COUNT,
  STARTER_SKILL_CATEGORIES,
  STARTER_SKILL_COUNT,
  STARTER_TAXONOMY_SOURCE,
  starterInterests,
  starterSkills,
} from "@/server/taxonomy/starter-taxonomy";

/**
 * Pins the approved starter taxonomy membership so accidental drift is detected
 * in review rather than in a deployment.
 */

const APPROVED_SKILL_SLUGS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c-sharp",
  "cpp",
  "html",
  "css",
  "react",
  "next-js",
  "vue-js",
  "node-js",
  "express-js",
  "laravel",
  "django",
  "fastapi",
  "asp-net-core",
  "flutter",
  "react-native",
  "postgresql",
  "mysql",
  "mongodb",
  "machine-learning",
  "data-analysis",
  "git",
  "docker",
  "github-actions",
  "linux",
  "figma",
  "ui-ux-design",
  "cybersecurity",
  "unity",
] as const;

const APPROVED_INTEREST_SLUGS = [
  "web-development",
  "mobile-development",
  "artificial-intelligence",
  "machine-learning",
  "data-science",
  "cybersecurity",
  "cloud-devops",
  "game-development",
  "ui-ux-design",
  "open-source",
  "entrepreneurship",
  "internet-of-things",
  "robotics",
  "competitive-programming",
  "software-engineering",
] as const;

describe("starter taxonomy source", () => {
  it("identifies the product-owned approved source", () => {
    expect(STARTER_TAXONOMY_SOURCE).toBe(
      "TeamMate curated starter taxonomy — product-owner approved Phase 2 baseline.",
    );
  });
});

describe("starter skills", () => {
  it("contains exactly the approved 32 skills", () => {
    expect(STARTER_SKILL_COUNT).toBe(32);
    expect(starterSkills).toHaveLength(32);
  });

  it("contains exactly the approved slugs and nothing else", () => {
    expect([...starterSkills].map((skill) => skill.slug).sort()).toEqual(
      [...APPROVED_SKILL_SLUGS].sort(),
    );
  });

  it("uses only the approved categories", () => {
    for (const skill of starterSkills) {
      expect(STARTER_SKILL_CATEGORIES).toContain(skill.category);
    }
  });

  it("has unique slugs, names, and normalized keys", () => {
    const slugs = starterSkills.map((skill) => skill.slug);
    const names = starterSkills.map((skill) => skill.name);
    const keys = starterSkills.map((skill) => skill.nameKey);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives every normalized key from its display name", () => {
    for (const skill of starterSkills) {
      expect(skill.nameKey).toBe(toNameKey(skill.name));
    }
  });

  it("uses a valid slug and a valid name for every entry", () => {
    for (const skill of starterSkills) {
      expect(isValidTaxonomySlug(skill.slug), skill.slug).toBe(true);
      expect(isValidTaxonomyName(skill.name), skill.name).toBe(true);
    }
  });

  it("keeps React and React.js style distinctness out of the set", () => {
    // "React" is present; "React.js" is not, and nothing folds them together.
    expect(starterSkills.some((skill) => skill.name === "React")).toBe(true);
    expect(starterSkills.some((skill) => skill.name === "React.js")).toBe(
      false,
    );
  });
});

describe("starter interests", () => {
  it("contains exactly the approved 15 interests", () => {
    expect(STARTER_INTEREST_COUNT).toBe(15);
    expect(starterInterests).toHaveLength(15);
  });

  it("contains exactly the approved slugs and nothing else", () => {
    expect([...starterInterests].map((entry) => entry.slug).sort()).toEqual(
      [...APPROVED_INTEREST_SLUGS].sort(),
    );
  });

  it("has unique slugs, names, and normalized keys", () => {
    const slugs = starterInterests.map((entry) => entry.slug);
    const names = starterInterests.map((entry) => entry.name);
    const keys = starterInterests.map((entry) => entry.nameKey);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives every normalized key from its display name", () => {
    for (const entry of starterInterests) {
      expect(entry.nameKey).toBe(toNameKey(entry.name));
    }
  });

  it("uses a valid slug and a valid name for every entry", () => {
    for (const entry of starterInterests) {
      expect(isValidTaxonomySlug(entry.slug), entry.slug).toBe(true);
      expect(isValidTaxonomyName(entry.name), entry.name).toBe(true);
    }
  });
});

describe("starter definition integrity", () => {
  it("passes the shared seed-definition validator", () => {
    expect(validateStarterTaxonomy(starterSkills, starterInterests)).toEqual(
      [],
    );
  });

  it("keeps the two lists independent of each other", () => {
    // "machine-learning" and "ui-ux-design" intentionally appear in both lists.
    // They are separate domains, so cross-list duplication is expected.
    const skillSlugs = new Set(starterSkills.map((skill) => skill.slug));
    const interestSlugs = new Set(starterInterests.map((entry) => entry.slug));

    expect(skillSlugs.has("machine-learning")).toBe(true);
    expect(interestSlugs.has("machine-learning")).toBe(true);
  });
});
