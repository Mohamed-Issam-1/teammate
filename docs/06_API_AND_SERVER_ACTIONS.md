# API and Server Action Contracts

## Principles

- Validate at the server boundary.
- Authorize after authentication and before mutation/read of protected data.
- Return predictable typed errors.
- Avoid exposing raw Prisma/provider exceptions.
- Design duplicate submissions safely.

## Server Action result shape

Use a consistent project pattern such as:

```ts
type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "VALIDATION_ERROR"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONFLICT"
        | "RATE_LIMITED"
        | "INTERNAL_ERROR";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
```

The exact helper may evolve, but consistency is required.

## Candidate server actions

- create/update/archive project;
- apply/withdraw;
- invite/revoke/respond invitation;
- application decision;
- membership role change/remove/leave;
- task create/update/move/delete;
- notification mark read;
- profile update.

## Route handlers

### Auth
`/api/auth/[...all]` — Better Auth.

### Uploads
A server-authorized endpoint/action creates presigned upload intent and records/validates ownership.

### AI
Protected AI matching endpoint:
- authenticates;
- authorizes project access;
- rate limits;
- selects eligible candidates server-side;
- computes deterministic scores;
- calls AI only for allowed enrichment/explanation;
- validates AI response;
- stores safe result metadata.

### Webhooks
Any provider webhook:
- verifies signature;
- validates payload;
- handles replay/idempotency;
- does not trust URL/body identity claims without verification.

## Versioning

Internal Server Actions do not require public API versioning.

If a stable external API is introduced, add an ADR before defining `/api/v1/...`.
