import { z } from "zod";

/**
 * Environment parsing is split into two contracts:
 *
 * - `parseEnv` preserves the Phase 0 database-only contract used by
 *   `scripts/db-check.ts` and other non-auth runtime checks.
 * - `parseAuthEnv` adds the server-only Better Auth requirements for the auth
 *   runtime and CLI configuration boundary.
 *
 * Both functions are pure with respect to the supplied record, treat empty
 * strings as unset, and never include environment values in error messages.
 */

const NODE_ENV_VALUES = ["development", "test", "production"] as const;
const INSECURE_SECRET_PLACEHOLDER = "replace-with-a-long-random-secret";

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPostgresConnectionString(value: string): boolean {
  return value.startsWith("postgresql://") || value.startsWith("postgres://");
}

function normalizeEnv(
  raw: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = value === undefined || value === "" ? undefined : value;
  }
  return normalized;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const name =
        issue.path.length > 0 ? String(issue.path[0]) : "environment";
      return `${name}: ${issue.message}`;
    })
    .join("; ");
}

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().refine(isPostgresConnectionString, {
    message: "DATABASE_URL must be a postgresql:// connection string",
  }),
  NODE_ENV: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        (NODE_ENV_VALUES as readonly string[]).includes(value),
      {
        message: `NODE_ENV must be one of: ${NODE_ENV_VALUES.join(", ")}`,
      },
    ),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .optional()
    .refine((value) => value === undefined || isAbsoluteHttpUrl(value), {
      message: "NEXT_PUBLIC_APP_URL must be an absolute http(s) URL",
    }),
});

export type Env = z.infer<typeof baseEnvSchema>;

const authEnvSchema = z.object({
  DATABASE_URL: z.string().refine(isPostgresConnectionString, {
    message: "DATABASE_URL must be a postgresql:// connection string",
  }),
  NODE_ENV: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        (NODE_ENV_VALUES as readonly string[]).includes(value),
      {
        message: `NODE_ENV must be one of: ${NODE_ENV_VALUES.join(", ")}`,
      },
    ),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
    .refine((value) => value !== INSECURE_SECRET_PLACEHOLDER, {
      message: "BETTER_AUTH_SECRET must not use the example placeholder",
    }),
  BETTER_AUTH_URL: z.string().refine(isAbsoluteHttpUrl, {
    message: "BETTER_AUTH_URL must be an absolute http(s) URL",
  }),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

const BASE_REQUIRED_KEYS = ["DATABASE_URL"] as const;
const AUTH_REQUIRED_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

function missingMessage(keys: readonly string[]): string {
  return `Missing required environment variables: ${keys.join(", ")}`;
}

/**
 * Validate the Phase 0 database-only environment contract.
 *
 * @throws {Error} naming offending variables only; values are never included.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const normalized = normalizeEnv(raw);
  const missing = BASE_REQUIRED_KEYS.filter(
    (key) => normalized[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(missingMessage(missing));
  }

  const result = baseEnvSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables - ${formatIssues(result.error)}`,
    );
  }

  return result.data;
}

/**
 * Validate the server-only Better Auth environment contract.
 *
 * This is intentionally separate from `parseEnv` so `db:check` does not
 * require auth secrets or URLs.
 */
export function parseAuthEnv(raw: Record<string, string | undefined>): AuthEnv {
  const normalized = normalizeEnv(raw);
  const missing = AUTH_REQUIRED_KEYS.filter(
    (key) => normalized[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(missingMessage(missing));
  }

  const result = authEnvSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables - ${formatIssues(result.error)}`,
    );
  }

  return result.data;
}
