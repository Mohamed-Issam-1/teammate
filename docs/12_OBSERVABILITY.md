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
