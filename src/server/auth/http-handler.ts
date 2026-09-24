import { safeAuthLogger } from "./logger";

type AuthRequestHandler = (request: Request) => Promise<Response>;

/**
 * Contain errors that escape Better Auth before they reach the Next.js server.
 *
 * Better Auth is configured with `onAPIError.throw` so better-call rethrows
 * non-API failures before its raw console sink. Expected Better Auth APIErrors
 * are converted back into safe responses by better-call and never reach here.
 */
export function createGuardedAuthHandler(
  handler: AuthRequestHandler,
): AuthRequestHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch {
      // Never inspect, stringify, attach, or forward the untrusted error.
      safeAuthLogger.log("error");
      return new Response(null, {
        status: 500,
        headers: { "cache-control": "no-store" },
      });
    }
  };
}
