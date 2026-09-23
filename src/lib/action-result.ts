/**
 * Canonical Server Action result shape.
 *
 * Source: docs/06_API_AND_SERVER_ACTIONS.md. Keep this module minimal —
 * consistency is required, a generic result framework is not.
 */

export type ActionResultErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionResultErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = undefined>(
  code: ActionResultErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return fieldErrors === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, fieldErrors };
}

export function isOk<T>(
  result: ActionResult<T>,
): result is { ok: true; data: T } {
  return result.ok;
}

export function isFail<T>(
  result: ActionResult<T>,
): result is Extract<ActionResult<T>, { ok: false }> {
  return !result.ok;
}
