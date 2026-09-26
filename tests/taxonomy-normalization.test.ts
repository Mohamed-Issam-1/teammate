// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  isSingleTokenName,
  isValidTaxonomyName,
  isValidTaxonomySlug,
  toNameKey,
  validateStarterTaxonomy,
} from "@/server/taxonomy/normalize";

/**
 * The normalization contract is deterministic lowercase folding only. These tests
 * pin exactly that, and deliberately do not assert any confusable, homoglyph, or
 * fuzzy behavior the implementation does not have.
 */

describe("toNameKey", () => {
  it("lowercases a plain name", () => {
    expect(toNameKey("React")).toBe("react");
    expect(toNameKey("TYPESCRIPT")).toBe("typescript");
  });

  it("trims leading and trailing whitespace", () => {
    expect(toNameKey("   React   ")).toBe("react");
    expect(toNameKey("\tReact\n")).toBe("react");
  });

  it("collapses internal whitespace runs to a single ASCII space", () => {
    expect(toNameKey("  Machine   Learning ")).toBe("machine learning");
    expect(toNameKey("a\t\t\tb")).toBe("a b");
    expect(toNameKey("a\n\nb")).toBe("a b");
  });

  it("applies Unicode NFC normalization before folding", () => {
    // U+00E9 versus "e" + U+0301 must produce the same key.
    const composed = toNameKey("Café");
    const decomposed = toNameKey("Café");

    expect(composed).toBe("café");
    expect(decomposed).toBe(composed);
  });

  it("supports Unicode display names", () => {
    expect(toNameKey("Интернет вещей")).toBe("интернет вещей");
    expect(toNameKey("C++")).toBe("c++");
    expect(toNameKey("UI/UX Design")).toBe("ui/ux design");
  });

  it("gives React and react the same key", () => {
    expect(toNameKey("React")).toBe(toNameKey("react"));
    expect(toNameKey("REACT")).toBe(toNameKey("React"));
  });

  it("keeps React and React.js distinct", () => {
    expect(toNameKey("React")).not.toBe(toNameKey("React.js"));
  });

  it("is idempotent", () => {
    for (const name of [
      "  Machine   Learning ",
      "React",
      "Café",
      "UI/UX Design",
    ]) {
      const once = toNameKey(name);
      expect(toNameKey(once)).toBe(once);
    }
  });

  it("does not fold a Cyrillic homoglyph onto its Latin counterpart", () => {
    // "Reаct" uses U+0430 (Cyrillic a) instead of U+0061 (Latin a).
    // Deterministic lowercase folding does not conflate scripts, and this test
    // pins that honest limitation rather than claiming protection we lack.
    const cyrillic = toNameKey("Reаct");

    expect(cyrillic).toBe("reаct");
    expect(cyrillic).not.toBe("react");
  });
});

describe("isValidTaxonomySlug", () => {
  it("accepts the approved slug examples", () => {
    for (const slug of [
      "react",
      "next-js",
      "machine-learning",
      "ui-ux",
      "c-sharp",
      "cpp",
      "asp-net-core",
      "a",
      "1",
    ]) {
      expect(isValidTaxonomySlug(slug), slug).toBe(true);
    }
  });

  it("rejects uppercase", () => {
    expect(isValidTaxonomySlug("React")).toBe(false);
    expect(isValidTaxonomySlug("Machine-Learning")).toBe(false);
  });

  it("rejects underscores and other separators", () => {
    expect(isValidTaxonomySlug("machine_learning")).toBe(false);
    expect(isValidTaxonomySlug("machine.learning")).toBe(false);
    expect(isValidTaxonomySlug("machine learning")).toBe(false);
  });

  it("rejects repeated, leading, and trailing hyphens", () => {
    expect(isValidTaxonomySlug("machine--learning")).toBe(false);
    expect(isValidTaxonomySlug("-machine")).toBe(false);
    expect(isValidTaxonomySlug("machine-")).toBe(false);
    expect(isValidTaxonomySlug("-")).toBe(false);
  });

  it("rejects any whitespace", () => {
    expect(isValidTaxonomySlug(" machine-learning")).toBe(false);
    expect(isValidTaxonomySlug("machine-learning ")).toBe(false);
    expect(isValidTaxonomySlug("machine\tlearning")).toBe(false);
  });

  it("rejects non-ASCII and empty slugs", () => {
    expect(isValidTaxonomySlug("تعلم")).toBe(false);
    expect(isValidTaxonomySlug("café")).toBe(false);
    expect(isValidTaxonomySlug("")).toBe(false);
  });

  it("rejects an over-long slug", () => {
    expect(isValidTaxonomySlug("a".repeat(65))).toBe(false);
  });
});

describe("taxonomy name validation", () => {
  it("accepts a non-empty trimmed name", () => {
    expect(isValidTaxonomyName("React")).toBe(true);
    expect(isValidTaxonomyName("C++")).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(isValidTaxonomyName("")).toBe(false);
    expect(isValidTaxonomyName("   ")).toBe(false);
  });

  it("accepts approved names that contain whitespace", () => {
    // The curated taxonomy relies on this: rejecting internal whitespace would
    // invalidate entries such as "Machine Learning" and "Cloud & DevOps".
    for (const name of ["Machine Learning", "Cloud & DevOps", "UI/UX Design"]) {
      expect(isValidTaxonomyName(name), name).toBe(true);
    }
  });

  it("recognises a single-token value with no whitespace or control characters", () => {
    expect(isSingleTokenName("react")).toBe(true);
    expect(isSingleTokenName("C++")).toBe(true);
    expect(isSingleTokenName("Machine Learning")).toBe(false);
    expect(isSingleTokenName("has\ttab")).toBe(false);
    expect(isSingleTokenName(`has${String.fromCharCode(0)}nul`)).toBe(false);
    expect(isSingleTokenName("")).toBe(false);
  });
});

describe("validateStarterTaxonomy", () => {
  const valid = [
    { slug: "react", name: "React", nameKey: "react" },
    { slug: "vue-js", name: "Vue.js", nameKey: "vue.js" },
  ];

  it("accepts a well-formed set", () => {
    expect(validateStarterTaxonomy(valid, [])).toEqual([]);
  });

  it("rejects an invalid slug", () => {
    const problems = validateStarterTaxonomy(
      [{ slug: "React", name: "React", nameKey: "react" }],
      [],
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toMatch(/slug/);
  });

  it("rejects duplicate slug, name, and name key", () => {
    const problems = validateStarterTaxonomy(
      [
        { slug: "react", name: "React", nameKey: "react" },
        { slug: "react", name: "Other", nameKey: "other" },
        { slug: "other", name: "Other", nameKey: "other" },
        { slug: "third", name: "Other", nameKey: "third" },
        { slug: "fourth", name: "Fourth", nameKey: "other" },
      ],
      [],
    );

    const messages = problems.map((problem) => problem.problem);
    expect(messages.some((m) => /duplicate slug/.test(m))).toBe(true);
    expect(messages.some((m) => /duplicate name/.test(m))).toBe(true);
    expect(messages.some((m) => /duplicate normalized name key/.test(m))).toBe(
      true,
    );
  });

  it("rejects an empty name and an empty normalized key", () => {
    const problems = validateStarterTaxonomy(
      [{ slug: "react", name: "   ", nameKey: "" }],
      [],
    );

    const messages = problems.map((problem) => problem.problem);
    expect(messages.some((m) => /name is empty/.test(m))).toBe(true);
    expect(messages.some((m) => /normalized name key is empty/.test(m))).toBe(
      true,
    );
  });

  it("validates interests as well as skills", () => {
    const problems = validateStarterTaxonomy(
      [],
      [{ slug: "Bad Slug", name: "Bad", nameKey: "bad" }],
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("interest");
  });
});
