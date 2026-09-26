import type { AuthEmailOperations } from "@/server/auth/options";

import {
  buildPasswordResetEmailContent,
  buildVerificationEmailContent,
} from "./content";
import type { ProductionAuthEmailConfigSource } from "./config";
import { AuthEmailDeliveryError } from "./errors";
import type { AuthEmailProvider } from "./provider";
import {
  assertProductionActionUrl,
  assertRecipientAddress,
  buildFromHeader,
  resolveTrustedOrigin,
} from "./safety";

/**
 * Production transactional auth email transport.
 *
 * Implements the existing `AuthEmailOperations` boundary so the Better Auth
 * callbacks stay provider-agnostic. Every send fails closed: configuration,
 * recipient, sender, and action URL are validated first, the provider is created
 * lazily from the validated key, and every failure — including a provider
 * returned error or a thrown network exception — becomes one sanitized
 * `AuthEmailDeliveryError` with no provider, recipient, URL, token, or
 * configuration detail attached.
 *
 * This module holds no secret, performs no network call at construction, and is
 * fully unit-testable through the injected provider boundary.
 */

export type ResendProductionEmailTransportOptions = {
  loadConfig: ProductionAuthEmailConfigSource;
  createProvider: (apiKey: string) => AuthEmailProvider;
};

type PreparedAuthEmail = {
  recipient: string;
  url: string;
  from: string;
  apiKey: string;
};

export class ResendProductionEmailTransport implements AuthEmailOperations {
  readonly #loadConfig: ProductionAuthEmailConfigSource;
  readonly #createProvider: (apiKey: string) => AuthEmailProvider;

  constructor({
    loadConfig,
    createProvider,
  }: ResendProductionEmailTransportOptions) {
    this.#loadConfig = loadConfig;
    this.#createProvider = createProvider;
  }

  async sendVerificationEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    const prepared = this.#prepare(input);
    const { subject, text, html } = buildVerificationEmailContent(prepared.url);

    await this.#deliver(prepared, { subject, text, html });
  }

  async sendPasswordResetEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    const prepared = this.#prepare(input);
    const { subject, text, html } = buildPasswordResetEmailContent(
      prepared.url,
    );

    await this.#deliver(prepared, { subject, text, html });
  }

  /**
   * Validate everything before any value reaches the content builders or the
   * provider. Order matters: the action URL is checked against the configured
   * trusted origin before it can be embedded in a message.
   */
  #prepare(input: { to: string; url: string }): PreparedAuthEmail {
    const config = this.#loadConfig();

    return {
      recipient: assertRecipientAddress(input.to),
      url: assertProductionActionUrl(
        input.url,
        resolveTrustedOrigin(config.baseUrl),
      ),
      from: buildFromHeader(config.fromAddress),
      apiKey: config.apiKey,
    };
  }

  async #deliver(
    prepared: PreparedAuthEmail,
    content: { subject: string; text: string; html: string },
  ): Promise<void> {
    let outcome: Awaited<ReturnType<AuthEmailProvider["send"]>>;

    try {
      const provider = this.#createProvider(prepared.apiKey);
      outcome = await provider.send({
        from: prepared.from,
        to: prepared.recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    } catch {
      // Never inspect, log, or re-throw the provider/network exception.
      throw new AuthEmailDeliveryError("provider-unavailable");
    }

    if (outcome?.delivered !== true) {
      throw new AuthEmailDeliveryError("provider-rejected");
    }
  }
}
