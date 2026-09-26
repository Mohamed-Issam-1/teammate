/**
 * Narrow injectable contract for transactional auth email delivery.
 *
 * This is the seam that keeps the production transport testable without network
 * access and keeps every other module free of provider SDK imports.
 *
 * The outcome deliberately carries no provider detail. A provider's returned
 * error result and thrown exception are both collapsed to `delivered: false` at
 * the SDK binding, so no provider response body, status code, or message can
 * travel upward into application code, logs, or HTTP responses.
 */
export type AuthEmailProviderMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type AuthEmailProviderOutcome =
  { delivered: true } | { delivered: false };

export type AuthEmailProvider = {
  send: (
    message: AuthEmailProviderMessage,
  ) => Promise<AuthEmailProviderOutcome>;
};
