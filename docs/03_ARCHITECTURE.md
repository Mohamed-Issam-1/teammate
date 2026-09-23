# Architecture

## Style

TeamMate starts as a modular monolith on Next.js. This intentionally avoids microservice operational complexity while keeping domain boundaries explicit.

## Layers

### `src/app`
Routing/composition only:
- pages/layouts;
- route handlers;
- loading/error boundaries;
- thin entry points into feature/server logic.

### `src/features`
Feature-specific UI and boundary schemas. A feature may contain:
- components;
- forms;
- client hooks;
- Zod schemas;
- feature types;
- small view-model helpers.

### `src/server`
Server-only capabilities:
- authentication/session access;
- authorization policy;
- database client;
- services/use-cases;
- provider adapters;
- rate limiting;
- storage;
- email;
- AI.

### `src/components`
- `ui`: design-system primitives;
- `shared`: reusable cross-feature components.

## Rendering strategy

Default to Server Components. Introduce `"use client"` at the narrowest reasonable boundary.

Good Client Component use cases:
- interactive form state;
- dialogs;
- drag/drop Kanban;
- optimistic UI;
- browser APIs.

Avoid making entire pages client components simply because one widget is interactive.

## Data flow

Typical protected mutation:

```text
Client/form
  -> Server Action / Route Handler
    -> authenticate
    -> validate input
    -> authorize resource/action
    -> service/use-case
    -> transaction/repository/Prisma
    -> activity/notification side effect
    -> typed result
  -> UI refresh/revalidation
```

## Server Actions vs Route Handlers

Use Server Actions for:
- project creation/edit forms;
- application decisions;
- membership changes;
- task mutations;
- settings forms.

Use Route Handlers for:
- Better Auth route;
- webhooks;
- presigned uploads;
- AI request endpoint when streaming/HTTP semantics help;
- external/public API contracts.

## Provider boundaries

Create small interfaces/wrappers for:
- email;
- object storage;
- AI;
- rate limiting/cache;
- error monitoring if custom wrapper adds value.

Do not create generic “repository/service factory” abstractions without a concrete need.

## Error handling

Separate:
- validation errors;
- unauthenticated;
- forbidden;
- not found;
- conflict/state transition;
- rate limited;
- provider/unavailable;
- unexpected internal error.

Do not expose stack traces or internal provider details to end users.

## Transactions

Required for operations such as:
- accepting application -> membership + application state + related invalidation/activity;
- accepting invitation -> membership + invitation state;
- ownership transfer;
- multi-record role transitions.

## Caching/revalidation

Use Next.js revalidation intentionally. Do not cache user-specific protected data globally. Cache public/stable reference data only when privacy and invalidation semantics are clear.

## Background work

Email delivery, heavy AI operations, and non-critical analytics should eventually execute asynchronously. Initial implementation may use a provider/serverless workflow integration, but interfaces must avoid coupling domain logic to one queue vendor.
