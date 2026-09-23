# UI / UX Specification

## Design direction

Professional collaboration SaaS:
- clean;
- information-dense without clutter;
- neutral base palette;
- semantic accent/status colors;
- strong typography hierarchy;
- consistent spacing/radius;
- restrained animation.

Use shadcn/ui primitives as a foundation, not as a reason for every page to look like a generic component demo.

## Core shells

### Public shell
- landing;
- discover projects;
- public profiles;
- auth entry points.

### Authenticated app shell
Desktop:
- left navigation;
- top utility bar;
- responsive content container.

Mobile:
- compact header;
- bottom nav or drawer depending on final IA;
- primary actions remain reachable.

## Main screens

- Landing
- Sign up / sign in / verification / reset
- Onboarding
- Dashboard
- Discover projects
- Project detail
- Create/edit project
- Applications/invitations
- People discovery
- Profile
- Project workspace
- Kanban
- Notifications
- Settings
- AI teammate suggestions
- Admin dashboard/users/projects/audit

## State design

Every data-driven surface must intentionally support:
- loading;
- empty;
- populated;
- recoverable error;
- forbidden/not found where applicable.

## Forms

- labels are always visible;
- server errors map back to fields where possible;
- disable/indicate submission state;
- preserve user input after recoverable errors;
- destructive actions require confirmation;
- keyboard flow is usable.

## Accessibility

- semantic headings;
- landmark structure;
- labels/descriptions;
- focus-visible states;
- dialogs return focus correctly;
- drag/drop Kanban has an accessible alternative if practical;
- never encode meaning using color alone.

## Responsive breakpoints

Do not design a desktop page and “stack everything” as an afterthought. Validate each feature at:
- small mobile (~360 px);
- tablet;
- laptop;
- wide desktop.

## Theming

Dark/light mode must be token-driven. Avoid duplicated arbitrary colors in feature components.
