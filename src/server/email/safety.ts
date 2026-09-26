import { AuthEmailDeliveryError } from "./errors";

/**
 * Input-safety boundary for the production transactional email transport.
 *
 * Everything crossing into an outbound message is validated here: recipient and
 * sender mailbox addresses, the Better Auth action URL that carries the
 * verification/reset token, and the HTML escaping applied to dynamic values.
 *
 * No validated value is ever included in a thrown error; failures always surface
 * as a fixed sanitized `AuthEmailDeliveryError`.
 */

/** Fixed display name. The display name is never configurable. */
export const AUTH_EMAIL_FROM_DISPLAY_NAME = "TeamMate";

const MAX_EMAIL_ADDRESS_LENGTH = 254;
const MAX_ACTION_URL_LENGTH = 2048;

/** C0 controls and DEL, including the CR/LF used to split or fold mail headers. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

/**
 * Deliberately conservative mailbox matcher.
 *
 * It accepts only a single plain `local@domain` address: no display name, no
 * angle brackets, no quoting, no comma lists, and no whitespace of any kind.
 */
const PLAIN_EMAIL_ADDRESS_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape every character that could break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

/** Reject non-string, empty, oversized, and CR/LF-bearing values before parsing. */
function assertBoundedPrintable(
  value: string,
  maximumLength: number,
  reason: "invalid-recipient" | "invalid-sender" | "invalid-url",
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new AuthEmailDeliveryError(reason);
  }
}

function assertPlainMailbox(
  value: string,
  reason: "invalid-recipient" | "invalid-sender",
): string {
  const candidate = typeof value === "string" ? value.trim() : "";

  if (
    candidate.length === 0 ||
    candidate.length > MAX_EMAIL_ADDRESS_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(candidate) ||
    !PLAIN_EMAIL_ADDRESS_PATTERN.test(candidate)
  ) {
    throw new AuthEmailDeliveryError(reason);
  }

  return candidate;
}

/**
 * Validate a recipient mailbox supplied by Better Auth.
 *
 * CR/LF and other control characters are rejected before parsing, so a crafted
 * address can never inject an additional header or recipient.
 */
export function assertRecipientAddress(value: string): string {
  return assertPlainMailbox(value, "invalid-recipient");
}

/**
 * Validate `AUTH_EMAIL_FROM_ADDRESS`.
 *
 * The environment value must be a bare mailbox. Display-name syntax such as
 * `TeamMate <no-reply@example.com>` is rejected outright: the display name is
 * fixed in code, so accepting a second header source here would defeat it.
 */
export function assertSenderAddress(value: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";

  if (
    candidate.includes("<") ||
    candidate.includes(">") ||
    candidate.includes('"')
  ) {
    throw new AuthEmailDeliveryError("invalid-sender");
  }

  return assertPlainMailbox(candidate, "invalid-sender");
}

/** Build the only permitted `From` header value from a validated address. */
export function buildFromHeader(address: string): string {
  return `${AUTH_EMAIL_FROM_DISPLAY_NAME} <${address}>`;
}

/** Resolve the single trusted origin that production action links must match. */
export function resolveTrustedOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    throw new AuthEmailDeliveryError("invalid-url");
  }
}

/**
 * Validate the Better Auth verification/reset URL before it is emailed.
 *
 * The URL carries a live auth token, so it must be an absolute HTTPS URL on the
 * exact configured `BETTER_AUTH_URL` origin, with no embedded credentials and no
 * control characters. A user-supplied callback origin can never satisfy this:
 * only the server-configured origin is compared.
 */
export function assertProductionActionUrl(
  value: string,
  trustedOrigin: string,
): string {
  assertBoundedPrintable(value, MAX_ACTION_URL_LENGTH, "invalid-url");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthEmailDeliveryError("invalid-url");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.origin !== trustedOrigin
  ) {
    throw new AuthEmailDeliveryError("invalid-url");
  }

  return value;
}
