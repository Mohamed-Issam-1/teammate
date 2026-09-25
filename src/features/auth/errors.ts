export type AuthClientAction =
  | "sign-in"
  | "sign-up"
  | "sign-out"
  | "verification"
  | "forgot-password"
  | "reset-password";

const GENERIC_AUTH_ERROR =
  "We couldn't complete that request. Please try again in a moment.";
const INVALID_CREDENTIALS_ERROR =
  "The email or password is incorrect. Please try again.";
const VERIFICATION_REQUIRED_ERROR =
  "Verify your email before signing in. You can request a new verification email.";
const INVALID_VERIFICATION_ERROR =
  "This verification link is invalid or has expired. Request a new verification email.";
const INVALID_RESET_ERROR =
  "This password reset link is invalid, expired, or already used. Request a new one.";
const RATE_LIMIT_ERROR =
  "Too many attempts. Please wait a moment before trying again.";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readErrorFacts(error: unknown): {
  code?: string;
  status?: number;
} {
  if (!isRecord(error)) {
    return {};
  }

  const nestedError = isRecord(error.error) ? error.error : undefined;
  const statusValue = error.status ?? nestedError?.status;
  const status =
    typeof statusValue === "number" && Number.isFinite(statusValue)
      ? statusValue
      : undefined;

  return {
    code: readString(error, "code") ?? readString(nestedError ?? {}, "code"),
    status,
  };
}

export function isAuthRateLimitError(error: unknown): boolean {
  const { code, status } = readErrorFacts(error);
  return status === 429 || code === "TOO_MANY_REQUESTS";
}

export function hasAuthErrorCode(
  error: unknown,
  expectedCode: string,
): boolean {
  return readErrorFacts(error).code === expectedCode;
}

/**
 * Map only explicitly supported Better Auth states to public copy. Provider,
 * Prisma, stack, and token-bearing error details are intentionally ignored.
 */
export function getAuthErrorMessage(
  error: unknown,
  action: AuthClientAction,
): string {
  const { code } = readErrorFacts(error);

  if (isAuthRateLimitError(error)) {
    return RATE_LIMIT_ERROR;
  }

  if (action === "sign-in" && code === "INVALID_EMAIL_OR_PASSWORD") {
    return INVALID_CREDENTIALS_ERROR;
  }

  if (action === "sign-in" && code === "EMAIL_NOT_VERIFIED") {
    return VERIFICATION_REQUIRED_ERROR;
  }

  if (action === "sign-in" && code === "SESSION_CREATION_NOT_ALLOWED") {
    return INVALID_CREDENTIALS_ERROR;
  }

  if (
    (action === "reset-password" || action === "verification") &&
    (code === "INVALID_TOKEN" ||
      code === "TOKEN_EXPIRED" ||
      code === "USER_NOT_FOUND")
  ) {
    return action === "reset-password"
      ? INVALID_RESET_ERROR
      : INVALID_VERIFICATION_ERROR;
  }

  return GENERIC_AUTH_ERROR;
}
