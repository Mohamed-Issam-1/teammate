import { z } from "zod";

/**
 * Phase 0 environment contract.
 *
 * Pure parsing/validation only: no `process.env` access and no `server-only`
 * marker, so this module stays unit-testable and can be imported by
 * standalone scripts (for example `scripts/db-check.ts` running under tsx,
 * where `server-only` would throw).
 *
 * Rules:
 * - only variables required by the current phase fail fast;
 * - empty strings are treated as unset (matches `.env.example` placeholders);
 * - error messages name variables only and never include values.
 */

const NODE_ENV_VALUES = ["development", "test", "production"] as const;

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

const envSchema = z.object({
  // Required by Phase 0 runtime behavior.
  DATABASE_URL: z.string().refine(isPostgresConnectionString, {
    message: "DATABASE_URL must be a postgresql:// connection string",
  }),

  // Validated when present, but not required.
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
  // Kept optional: Phase 0 has no genuine need for an absolute app URL.
  NEXT_PUBLIC_APP_URL: z
    .string()
    .optional()
    .refine((value) => value === undefined || isAbsoluteHttpUrl(value), {
      message: "NEXT_PUBLIC_APP_URL must be an absolute http(s) URL",
    }),

  // Declared but never enforced until the owning phase.
  BETTER_AUTH_SECRET: z.string().optional(), // Phase 1
  BETTER_AUTH_URL: z.string().optional(), // Phase 1
  RESEND_API_KEY: z.string().optional(), // Phase 1+ email
  EMAIL_FROM: z.string().optional(), // Phase 1+ email
  REDIS_URL: z.string().optional(), // Phase 6
  S3_ENDPOINT: z.string().optional(), // Phase 5
  S3_REGION: z.string().optional(), // Phase 5
  S3_BUCKET: z.string().optional(), // Phase 5
  S3_ACCESS_KEY_ID: z.string().optional(), // Phase 5
  S3_SECRET_ACCESS_KEY: z.string().optional(), // Phase 5
  S3_PUBLIC_BASE_URL: z.string().optional(), // Phase 5
  OPENAI_API_KEY: z.string().optional(), // Phase 6
  SENTRY_DSN: z.string().optional(), // Phase 8
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(), // Phase 8
});

export type Env = z.infer<typeof envSchema>;

/** Variables that must exist for the current phase to run. */
const REQUIRED_KEYS = ["DATABASE_URL"] as const;

/**
 * Validate an environment record.
 *
 * @throws {Error} naming offending variables only; values are never included
 * in the message.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = value === undefined || value === "" ? undefined : value;
  }

  const missing = REQUIRED_KEYS.filter((key) => normalized[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  const result = envSchema.safeParse(normalized);
  if (!result.success) {
    const details = result.error.issues.map((issue) => {
      const name =
        issue.path.length > 0 ? String(issue.path[0]) : "environment";
      return `${name}: ${issue.message}`;
    });
    throw new Error(`Invalid environment variables - ${details.join("; ")}`);
  }

  return result.data;
}
