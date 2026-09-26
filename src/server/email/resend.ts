import "server-only";

import { Resend } from "resend";

import type {
  AuthEmailProvider,
  AuthEmailProviderMessage,
  AuthEmailProviderOutcome,
} from "./provider";

/**
 * Bind the Resend SDK to the narrow auth email provider contract.
 *
 * This is the only module in the repository that imports the provider SDK. No
 * application module depends on Resend directly, and no provider error object is
 * allowed past this boundary: the SDK's `{ data, error }` result is collapsed to
 * a boolean outcome here so a provider response body, status code, or message
 * cannot reach a log, a stack trace, or a browser.
 *
 * The client is constructed per send from an already-validated API key, so
 * importing this module never requires or captures a secret.
 */
export function createResendAuthEmailProvider(
  apiKey: string,
): AuthEmailProvider {
  const client = new Resend(apiKey);

  return {
    async send(
      message: AuthEmailProviderMessage,
    ): Promise<AuthEmailProviderOutcome> {
      const { error } = await client.emails.send({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      return error ? { delivered: false } : { delivered: true };
    },
  };
}
