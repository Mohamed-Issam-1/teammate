/**
 * Shared display ordering for taxonomy-backed lists.
 *
 * The rule established when own assignments were built is reused here so a
 * profile's skills and that user's own skills never appear in different orders:
 * category ascending with `null` last, then name ascending.
 *
 * `null` sorts last rather than first because PostgreSQL's `ASC` default places
 * NULLs last. Substituting an empty string would float uncategorized entries to
 * the top, contradicting both the database default and the taxonomy read
 * boundary.
 */

/** Compare two optional categories, sorting `null` last. */
export function compareNullableCategory(
  a: string | null,
  b: string | null,
): number {
  if (a === b) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a.localeCompare(b);
}

/** Order named entries by category (nulls last), then by name. */
export function compareByCategoryThenName(
  a: { category: string | null; name: string },
  b: { category: string | null; name: string },
): number {
  const byCategory = compareNullableCategory(a.category, b.category);
  return byCategory === 0 ? a.name.localeCompare(b.name) : byCategory;
}
