/**
 * Taxonomy normalization contract.
 *
 * Deliberately small, pure, and dependency-free so the rules can be unit tested
 * without a database. Nothing here reads the environment or imports a driver.
 */

/**
 * Approved slug grammar: lowercase alphanumeric groups joined by single hyphens.
 *
 * Slugs are curated, never derived from a display name, so a name like
 * "C++" maps to the explicit `cpp` rather than to a mangled form.
 */
export const TAXONOMY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const TAXONOMY_SLUG_MAX_LENGTH = 64;
export const TAXONOMY_NAME_MAX_LENGTH = 120;

const ASCII_WHITESPACE = /\s/;

/** True when a value contains no whitespace and no C0/DEL control character. */
export function isSingleTokenName(value: string): boolean {
  return (
    value.length > 0 &&
    !ASCII_WHITESPACE.test(value) &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

/**
 * Derive the case-insensitive uniqueness key for a taxonomy display name.
 *
 * Steps, in order:
 *  1. Unicode NFC normalization;
 *  2. trim leading and trailing whitespace;
 *  3. collapse internal whitespace runs to a single ASCII space;
 *  4. lowercase.
 *
 * This is deterministic lowercase normalization only. It is **not** Unicode full
 * case folding, **not** homoglyph or confusable detection, and **not** fuzzy
 * matching or semantic aliasing. A Cyrillic homoglyph is therefore not assumed to
 * collide with the corresponding Latin character.
 *
 * "React" and "react" produce the same key, so they cannot both exist.
 * "React" and "React.js" produce different keys and remain distinct entries.
 */
export function toNameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when `value` is a single non-whitespace-free ASCII slug token. */
export function isValidTaxonomySlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TAXONOMY_SLUG_MAX_LENGTH &&
    TAXONOMY_SLUG_PATTERN.test(value)
  );
}

/**
 * True when a display name is non-empty once trimmed and within the length cap.
 *
 * Whitespace and non-ASCII characters are intentionally allowed: approved names
 * include "Machine Learning" and "Cloud & DevOps". Rejecting internal whitespace
 * would invalidate the curated taxonomy.
 */
export function isValidTaxonomyName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= TAXONOMY_NAME_MAX_LENGTH;
}

export type TaxonomyDefinitionProblem = {
  /** Which approved list the entry came from. */
  kind: "skill" | "interest";
  /** Curated slug, when the entry has one. */
  slug?: string;
  /** Human-readable description of the problem. Never contains a database value. */
  problem: string;
};

/**
 * Validate an in-memory seed set before any database write.
 *
 * Catches a malformed or internally inconsistent seed definition so the command
 * fails before touching the database, rather than half-applying it.
 */
export function validateStarterTaxonomy(
  skills: readonly { slug: string; name: string; nameKey: string }[],
  interests: readonly { slug: string; name: string; nameKey: string }[],
): TaxonomyDefinitionProblem[] {
  const problems: TaxonomyDefinitionProblem[] = [];

  const check = (
    kind: "skill" | "interest",
    entries: readonly { slug: string; name: string; nameKey: string }[],
  ) => {
    const slugs = new Set<string>();
    const names = new Set<string>();
    const nameKeys = new Set<string>();

    for (const entry of entries) {
      if (!isValidTaxonomySlug(entry.slug)) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "slug does not match the approved slug grammar",
        });
      }

      if (!isValidTaxonomyName(entry.name)) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "name is empty or too long",
        });
      }

      if (entry.nameKey.length === 0) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "normalized name key is empty",
        });
      }

      if (slugs.has(entry.slug)) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "duplicate slug in seed set",
        });
      }

      if (names.has(entry.name)) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "duplicate name in seed set",
        });
      }

      if (nameKeys.has(entry.nameKey)) {
        problems.push({
          kind,
          slug: entry.slug,
          problem: "duplicate normalized name key in seed set",
        });
      }

      slugs.add(entry.slug);
      names.add(entry.name);
      nameKeys.add(entry.nameKey);
    }
  };

  check("skill", skills);
  check("interest", interests);

  return problems;
}
