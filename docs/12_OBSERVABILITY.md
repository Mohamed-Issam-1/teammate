# Observability

## Goals

When a production failure occurs, determine:
- what failed;
- which feature/request was involved;
- whether it is user-specific or systemic;
- whether data may be inconsistent;
- whether an external provider failed;
- whether a security event occurred.

## Error monitoring

Use Sentry or equivalent for:
- uncaught server errors;
- significant client errors;
- release/environment tags.

Never attach secrets or full sensitive payloads.

## Structured logging

Prefer structured events containing:
- event name;
- environment;
- request/correlation ID where available;
- safe actor/resource IDs;
- duration;
- outcome/error code.

Never log:
- password;
- auth/session token;
- reset/verification token;
- API key;
- raw cookie;
- full private profile payload.

## Phase 1 signals already emitted

Phase 1 deliberately emits very little, because the authentication logging
boundary discards every framework-supplied argument. Two fixed messages exist
today, both argument-free:

- `"Better Auth could not complete an operation."` — an auth operation failed.
  This is intentionally not actionable on its own; it covers unknown framework
  and database failures alike.
- `"Verification email delivery failed."` — a transactional verification email
  could not be delivered. This is the actionable one.

The second message exists because verification-delivery failures are normalized
before they can reach the HTTP response, so without it a total verification
outage would be invisible while every sign-up silently appeared to succeed.

### Operator runbook for `"Verification email delivery failed."`

A recurring occurrence means auth email is not being delivered. The cause is
configuration, not code. Check, in order:

1. `RESEND_API_KEY` is set and non-empty in the deployment.
2. `AUTH_EMAIL_FROM_ADDRESS` is a bare mailbox — no display-name syntax, no
   angle brackets.
3. The sender domain is verified in Resend. An unverified domain is the most
   common cause and the API key will look perfectly valid.
4. `BETTER_AUTH_URL` is an absolute **HTTPS** URL. Production refuses to send
   over plaintext, so a plain `http://` origin fails closed here.
5. The deployment's clock and the `BETTER_AUTH_URL` origin match the domain the
   links are expected to point at, since the emailed link origin must match
   exactly.

Never add recipient addresses, verification links, tokens, API keys, or provider
response bodies to a log line or an error tracker payload to diagnose this. The
fixed message and the deployment configuration are sufficient.

Rate limiting will mask a persistent outage: repeated failures still return a
normal response to the browser, by design, so alert on the rate of this message
rather than on user-visible errors.

## Product metrics

Track high-level funnels/events without invasive profiling:
- onboarding complete;
- project created;
- application sent/decided;
- invitation sent/responded;
- membership created;
- task created/completed;
- AI match requested/completed/failed.

## AI observability

Track:
- request count;
- latency;
- model identifier;
- token/usage estimate;
- cost estimate if available;
- deterministic candidate count;
- failure rate.

Do not store unnecessary prompt content for analytics.
