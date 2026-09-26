import "server-only";

import { authEnv } from "@/server/auth/env";
import type { AuthEmailOperations } from "@/server/auth/options";

import { createProductionAuthEmailConfigSource } from "./config";
import { InMemoryDevelopmentEmailTransport } from "./development";
import { createE2EAuthEmailTransport } from "./e2e";
import { ResendProductionEmailTransport } from "./production";
import { createResendAuthEmailProvider } from "./resend";

/**
 * Runtime auth email boundary.
 *
 * Development messages are retained only in bounded, short-lived process memory.
 * Integration tests inject an isolated in-process capture. Neither path exposes a
 * mailbox route, persists to disk, or logs URLs/tokens.
 *
 * Production delegates to the Resend-backed adapter. Nothing in this module
 * requires a real credential at import time: the configuration is resolved and
 * the provider client is constructed only when a send is actually attempted, so
 * `npm ci`, `prisma generate`, local development, tests, and a CI `next build`
 * never need `RESEND_API_KEY` or `AUTH_EMAIL_FROM_ADDRESS`. Production sending
 * therefore fails closed, with a sanitized error and no partial delivery, until
 * the deployment supplies them.
 *
 * The trusted origin comes from the already-validated auth environment so email
 * link validation and Better Auth share one source of truth.
 *
 * Selection order:
 *
 * 1. `NODE_ENV === "production"` always selects the Resend adapter. The E2E
 *    capture transport is unreachable from any production-mode process, so the
 *    test-only boundary can never be activated by a deployment.
 * 2. An explicit E2E context marker selects the filesystem capture transport
 *    used by Playwright, which is inert during ordinary local development.
 * 3. Everything else keeps the bounded in-memory development mailbox.
 */
const productionEmail = new ResendProductionEmailTransport({
  loadConfig: createProductionAuthEmailConfigSource({
    env: process.env,
    baseUrl: authEnv.BETTER_AUTH_URL,
  }),
  createProvider: createResendAuthEmailProvider,
});

const developmentEmail = new InMemoryDevelopmentEmailTransport();

function selectAuthEmailOperations(): AuthEmailOperations {
  if (process.env.NODE_ENV === "production") {
    return productionEmail;
  }

  return createE2EAuthEmailTransport(process.env) ?? developmentEmail;
}

export const authEmail: AuthEmailOperations = selectAuthEmailOperations();
