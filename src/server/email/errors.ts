/**
 * Sanitized internal error for every transactional auth email failure.
 *
 * The message is a fixed constant, and the `reason` is a closed allow-list of
 * non-sensitive labels. No provider response, recipient address, action URL,
 * token, or configuration value is ever attached — including through `cause` —
 * so the error is safe to log, inspect, and serialize anywhere.
 */
export const AUTH_EMAIL_DELIVERY_ERROR_MESSAGE =
  "Auth email could not be delivered.";

export type AuthEmailDeliveryFailureReason =
  | "not-configured"
  | "invalid-recipient"
  | "invalid-sender"
  | "invalid-url"
  | "provider-unavailable"
  | "provider-rejected";

export class AuthEmailDeliveryError extends Error {
  readonly reason: AuthEmailDeliveryFailureReason;

  constructor(reason: AuthEmailDeliveryFailureReason) {
    super(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);
    this.name = "AuthEmailDeliveryError";
    this.reason = reason;
  }
}
