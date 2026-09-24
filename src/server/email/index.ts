import "server-only";

import type { AuthEmailOperations } from "@/server/auth/options";

import { InMemoryDevelopmentEmailTransport } from "./development";

const developmentEmail = new InMemoryDevelopmentEmailTransport();

const unavailableProductionEmail: AuthEmailOperations = {
  sendVerificationEmail: async () => {
    throw new Error("Auth email delivery is not configured");
  },
  sendPasswordResetEmail: async () => {
    throw new Error("Auth email delivery is not configured");
  },
};

/**
 * Development/test email boundary.
 *
 * Development messages are retained only in bounded, short-lived process
 * memory. Integration tests inject an isolated in-process capture; neither path
 * exposes a mailbox route, persists to disk, or logs URLs/tokens. Production
 * fails closed until a reviewed provider adapter is introduced.
 */
export const authEmail: AuthEmailOperations =
  process.env.NODE_ENV === "production"
    ? unavailableProductionEmail
    : developmentEmail;
