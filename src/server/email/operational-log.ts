/**
 * Fixed operational signal for auth email delivery failure.
 *
 * This is deliberately separate from `safeAuthLogger`, whose fixed text is
 * shared by every Better Auth diagnostic and must not change: an operator needs
 * to be able to tell a verification-delivery failure apart from any other auth
 * error, without learning anything about the message that failed to send.
 *
 * The signal accepts no arguments at all. No recipient address, verification or
 * reset URL, token, API key, provider error object, provider response body,
 * stack, or `cause` can ever reach the output, so it is safe to emit from the
 * auth request path.
 */
export const AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE =
  "Verification email delivery failed.";

export function reportVerificationDeliveryFailure(): void {
  console.error(AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED_MESSAGE);
}
