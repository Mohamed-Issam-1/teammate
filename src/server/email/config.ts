import { AuthEmailDeliveryError } from "./errors";
import { assertSenderAddress } from "./safety";

/**
 * Production auth email configuration.
 *
 * Resolved lazily, at the moment a real send is attempted, so `npm ci`, Prisma
 * generation, local development, unit tests, integration tests, and a CI
 * `next build` never require a real Resend credential. Nothing here runs at
 * module import, and no error message ever contains a configured value.
 */

export type ProductionAuthEmailConfig = {
  /** Validated Resend API key. Never logged, echoed, or attached to an error. */
  apiKey: string;
  /** Validated bare mailbox address; the display name is fixed in code. */
  fromAddress: string;
  /** Better Auth base URL whose origin production action links must match. */
  baseUrl: string;
};

export type ProductionAuthEmailConfigSource = () => ProductionAuthEmailConfig;

export type ProductionAuthEmailConfigInput = {
  /** Read on every call, so a live `process.env` is always the source of truth. */
  env: Record<string, string | undefined>;
  baseUrl: string;
};

const MIN_API_KEY_LENGTH = 8;
const MAX_API_KEY_LENGTH = 512;
const CREDENTIAL_CHARACTER_PATTERN = /^[!-~]+$/;

function notConfigured(): AuthEmailDeliveryError {
  return new AuthEmailDeliveryError("not-configured");
}

/**
 * A key must be a single printable ASCII run with no whitespace, so it can never
 * corrupt the provider's own Authorization header. The literal `re_` prefix is
 * intentionally not asserted so a future Resend key format is not rejected.
 */
function readApiKey(
  raw: string | undefined,
): ProductionAuthEmailConfig["apiKey"] {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (
    value.length < MIN_API_KEY_LENGTH ||
    value.length > MAX_API_KEY_LENGTH ||
    !CREDENTIAL_CHARACTER_PATTERN.test(value)
  ) {
    throw notConfigured();
  }

  return value;
}

/**
 * Refuse a plaintext production origin.
 *
 * Production action links must be HTTPS, so an HTTP `BETTER_AUTH_URL` would make
 * every verification and reset send fail closed with `invalid-url` and no
 * actionable signal. This check is deliberately lazy: it runs only when a
 * production send is attempted, so a CI build that supplies the build-only
 * `http://localhost:3000` dummy still succeeds, and local development over
 * plain HTTP is unaffected.
 */
function assertProductionHttpsBaseUrl(baseUrl: string): void {
  let protocol: string;
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    throw notConfigured();
  }

  if (protocol !== "https:") {
    throw notConfigured();
  }
}

/**
 * Build the lazy production configuration source.
 *
 * Empty strings are treated as unset, matching the rest of the environment
 * contract, so an empty `RESEND_API_KEY=` in a deployment fails closed at send
 * time instead of reaching the provider.
 */
export function createProductionAuthEmailConfigSource({
  env,
  baseUrl,
}: ProductionAuthEmailConfigInput): ProductionAuthEmailConfigSource {
  return () => {
    if (typeof env.RESEND_API_KEY !== "string") {
      throw notConfigured();
    }

    if (typeof env.AUTH_EMAIL_FROM_ADDRESS !== "string") {
      throw notConfigured();
    }

    if (env.NODE_ENV === "production") {
      assertProductionHttpsBaseUrl(baseUrl);
    }

    return {
      apiKey: readApiKey(env.RESEND_API_KEY),
      fromAddress: assertSenderAddress(env.AUTH_EMAIL_FROM_ADDRESS),
      baseUrl,
    };
  };
}
