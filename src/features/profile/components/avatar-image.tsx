/**
 * Avatar presentation shared by the own-profile page and the public profile.
 *
 * Two deliberate choices:
 *
 * - A plain `<img>` rather than `next/image`. The avatar route is authorized per
 *   viewer, so an image optimizer running on the server would fetch it *without*
 *   the viewer's cookie and cache the result for other viewers. That would break
 *   `PRIVATE` and `MEMBERS_ONLY` entirely. A same-origin `<img>` is requested by
 *   the browser with its own session, so authorization is applied per viewer and
 *   the bytes are never shared between users.
 * - `avatarUrl` is treated as an opaque server-owned path. It is only ever passed
 *   through as a same-origin path, and `referrerPolicy` is set so the request
 *   cannot leak the page URL to a third party.
 */

export function AvatarImage({
  avatarUrl,
  displayName,
  size = 56,
}: {
  /** The server-owned `/avatars/<token>` path, or `null`. */
  avatarUrl: string | null;
  displayName: string;
  size?: number;
}) {
  const initials = initialsOf(displayName);

  if (avatarUrl === null) {
    return <AvatarFallback initials={initials} size={size} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- authorized per-viewer bytes must not pass through a shared optimizer cache
    <img
      src={avatarUrl}
      alt={`${displayName}'s avatar`}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded-full border object-cover"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

export function AvatarFallback({
  initials,
  size = 56,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full border text-lg font-semibold"
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {initials.length > 0 ? initials : null}
    </div>
  );
}

/**
 * Up to two initials for the avatar placeholder.
 *
 * Derived from the display name, which is not unique and not normalized, so this
 * is presentation only and never used for identity or matching. Split with
 * `Array.from` so a name beginning with an astral character cannot split a
 * surrogate pair and render a replacement glyph.
 */
export function initialsOf(displayName: string): string {
  return Array.from(displayName)
    .join("")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}
