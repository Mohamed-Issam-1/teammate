type SessionUser = {
  accountStatus: string;
  emailVerified: boolean;
};

type SessionWithUser = {
  user: SessionUser;
};

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

export class EmailVerificationRequiredError extends Error {
  constructor() {
    super("Email verification required");
    this.name = "EmailVerificationRequiredError";
  }
}

/** Apply TeamMate's account-status policy to an authenticated library session. */
export function getActiveSession<T extends SessionWithUser>(
  session: T | null,
): T | null {
  if (!session || session.user.accountStatus !== "ACTIVE") {
    return null;
  }

  return session;
}

/** Require an active, verified TeamMate account. */
export function requireActiveVerifiedSession<T extends SessionWithUser>(
  session: T | null,
): T {
  const activeSession = getActiveSession(session);
  if (!activeSession) {
    throw new AuthenticationRequiredError();
  }

  if (!activeSession.user.emailVerified) {
    throw new EmailVerificationRequiredError();
  }

  return activeSession;
}
