# Product Requirements Document — TeamMate

## Product goal

Enable students, developers, and project builders to find compatible teammates, form teams, and collaborate in one structured workflow.

## Primary users

### Project creator
Needs to define a project, required skills, team size, and evaluate applicants/invite candidates.

### Candidate/member
Needs to present skills/interests/availability, discover projects, apply, accept invitations, and collaborate.

### Platform administrator
Needs to moderate users/projects and review auditable platform events.

## Core jobs to be done

- “I have a project and need people with complementary skills.”
- “I want a project/team that fits my skills, interests, and availability.”
- “I need a clear way to move from discovery to accepted membership.”
- “Once the team forms, I need a lightweight shared workspace.”
- “I want useful AI suggestions, but I want humans to remain in control.”

## Success outcomes

A successful release allows a new user to:
1. register and verify the account;
2. complete a useful profile;
3. create or discover a project;
4. apply or invite;
5. form a team;
6. manage work in a Kanban workspace;
7. receive state-change notifications;
8. use AI suggestions for candidate discovery;
9. complete the flows on mobile and desktop.

## Product metrics for the portfolio release

Instrumentation should make these measurable:
- onboarding completion;
- projects created;
- applications sent;
- invitation acceptance;
- teams formed;
- tasks completed;
- AI suggestion requests and resulting profile/project views;
- error rates in critical flows.

Do not optimize vanity metrics before correctness.

## Product constraints

- No payments in initial release.
- No real-time chat in initial release.
- AI suggestions are advisory.
- Privacy/authorization rules override discoverability.
- Production-like engineering quality is part of the product goal.
