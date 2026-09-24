import type { AuthEmailOperations } from "@/server/auth/options";

export const DEVELOPMENT_EMAIL_MAX_MESSAGES = 50;
export const DEVELOPMENT_EMAIL_TTL_MS = 10 * 60 * 1000;

export type DevelopmentCapturedEmail = {
  kind: "verification" | "password-reset";
  to: string;
  url: string;
  createdAt: number;
  expiresAt: number;
};

type DevelopmentEmailTransportOptions = {
  maxMessages?: number;
  now?: () => number;
  ttlMs?: number;
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }

  return value;
}

/**
 * Process-local development mailbox with bounded retention.
 *
 * This transport is intentionally not durable and exposes no framework/HTTP
 * integration. Expired messages are removed before every write and read, and
 * the oldest entries are discarded whenever capacity is exceeded.
 */
export class InMemoryDevelopmentEmailTransport implements AuthEmailOperations {
  readonly #maxMessages: number;
  readonly #messages: DevelopmentCapturedEmail[] = [];
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(options: DevelopmentEmailTransportOptions = {}) {
    this.#maxMessages = positiveInteger(
      options.maxMessages ?? DEVELOPMENT_EMAIL_MAX_MESSAGES,
      "maxMessages",
    );
    this.#ttlMs = positiveInteger(
      options.ttlMs ?? DEVELOPMENT_EMAIL_TTL_MS,
      "ttlMs",
    );
    this.#now = options.now ?? Date.now;
  }

  async sendVerificationEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#retain("verification", input);
  }

  async sendPasswordResetEmail(input: {
    to: string;
    url: string;
  }): Promise<void> {
    this.#retain("password-reset", input);
  }

  /** Destructive test helper; runtime composition exposes only the send methods. */
  takeAll(): DevelopmentCapturedEmail[] {
    this.#pruneExpired();
    return this.#messages.splice(0);
  }

  #pruneExpired(): void {
    const now = this.#now();

    for (let index = this.#messages.length - 1; index >= 0; index -= 1) {
      const message = this.#messages[index];
      if (message && message.expiresAt <= now) {
        this.#messages.splice(index, 1);
      }
    }
  }

  #retain(
    kind: DevelopmentCapturedEmail["kind"],
    input: Pick<DevelopmentCapturedEmail, "to" | "url">,
  ): void {
    this.#pruneExpired();

    const createdAt = this.#now();
    this.#messages.push({
      kind,
      to: input.to,
      url: input.url,
      createdAt,
      expiresAt: createdAt + this.#ttlMs,
    });

    while (this.#messages.length > this.#maxMessages) {
      this.#messages.shift();
    }
  }
}
