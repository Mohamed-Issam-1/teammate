import "server-only";

/**
 * Same-origin enforcement for cookie-authenticated mutations.
 *
 * The avatar upload endpoint is a plain POST route, so it does not get the
 * framework-level Origin check that a Server Action receives. Without an explicit
 * check here, a cross-site form could post a multipart body to it using the
 * visitor's ambient session cookie.
 *
 * The comparison is against the server-configured application origin only. A
 * request-supplied origin is never trusted, and a missing Origin is refused rather
 * than assumed same-origin, because a browser that omits it is not a browser this
 * endpoint is meant to serve.
 */

export class CrossOriginRequestError extends Error {
  constructor() {
    super("Cross-origin request refused");
    this.name = "CrossOriginRequestError";
  }
}

/**
 * The configured application origin.
 *
 * `BETTER_AUTH_URL` is already validated as an absolute http(s) URL by the auth
 * environment contract, and its origin is what Better Auth itself uses as the
 * trusted origin, so this reuses the same source of truth rather than introducing
 * a second notion of "our origin".
 */
export function trustedApplicationOrigin(): string | null {
  const configured = process.env.BETTER_AUTH_URL;

  if (typeof configured !== "string" || configured.length === 0) {
    return null;
  }

  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * Refuse a mutation whose `Origin` is absent or is not the configured origin.
 *
 * @throws {CrossOriginRequestError}
 */
export function assertSameOriginMutation(request: Request): void {
  const origin = request.headers.get("origin");
  const trusted = trustedApplicationOrigin();

  if (origin === null || trusted === null || origin !== trusted) {
    throw new CrossOriginRequestError();
  }
}

/** Whether a content type is the multipart form type, ignoring parameters. */
export function isMultipartFormData(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "multipart/form-data";
}
