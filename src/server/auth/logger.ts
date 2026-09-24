import type { BetterAuthOptions } from "better-auth";

const AUTH_ERROR_MESSAGE = "Better Auth could not complete an operation.";
const AUTH_WARNING_MESSAGE = "Better Auth rejected an operation.";

/**
 * Logger for Better Auth's untrusted diagnostic arguments.
 *
 * Better Auth 1.7.5 may pass raw database/provider exceptions as trailing log
 * arguments. This adapter intentionally ignores every framework-supplied
 * message and argument, publishes only warn/error levels, and emits fixed text
 * that cannot contain passwords, tokens, cookies, URLs, secrets, or provider
 * response bodies.
 *
 * Better Auth 1.7.5's router-level API-error fallback bypasses the configured
 * callback and logs `APIError.message` globally when `level` is `error`, `warn`,
 * or `debug`. `info` deliberately avoids that upstream branch while the custom
 * callback still publishes only its fixed warning/error messages.
 */
export const safeAuthLogger = {
  disableColors: true,
  level: "info",
  log(level: "debug" | "error" | "info" | "warn"): void {
    if (level === "error") {
      console.error(AUTH_ERROR_MESSAGE);
      return;
    }

    if (level === "warn") {
      console.warn(AUTH_WARNING_MESSAGE);
    }
  },
} satisfies NonNullable<BetterAuthOptions["logger"]>;
