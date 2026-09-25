const VERIFICATION_EMAIL_STORAGE_KEY = "teammate:verification-email";

export function saveVerificationEmailPrefill(email: string): void {
  try {
    window.sessionStorage.setItem(VERIFICATION_EMAIL_STORAGE_KEY, email);
  } catch {
    // Session storage is an optional convenience and must never block signup.
  }
}

export function readVerificationEmailPrefill(): string | undefined {
  try {
    return (
      window.sessionStorage.getItem(VERIFICATION_EMAIL_STORAGE_KEY) ?? undefined
    );
  } catch {
    return undefined;
  }
}

export function clearVerificationEmailPrefill(): void {
  try {
    window.sessionStorage.removeItem(VERIFICATION_EMAIL_STORAGE_KEY);
  } catch {
    // Session storage is an optional convenience.
  }
}
