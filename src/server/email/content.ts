import {
  AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
} from "@/server/auth/token-expiry";

import { escapeHtml } from "./safety";

/**
 * Transactional auth email content.
 *
 * Two concise, hand-built messages with no template dependency. The only
 * dynamic value is the Better Auth action URL, which already carries the token,
 * so the token is never rendered as a separate value, and no internal user ID,
 * account status, provider data, or secret is included. Expiry wording is derived
 * from the shared auth token policy so copy and configured lifetimes cannot drift.
 */

export const VERIFICATION_EMAIL_SUBJECT = "Verify your TeamMate email";
export const PASSWORD_RESET_EMAIL_SUBJECT = "Reset your TeamMate password";

export type AuthEmailContent = {
  subject: string;
  text: string;
  html: string;
};

type AuthEmailLayout = {
  heading: string;
  introduction: string;
  actionLabel: string;
  actionUrl: string;
  expiryNotice: string;
  closingNotice: string;
};

function formatExpiry(expiresInSeconds: number): string {
  if (expiresInSeconds > 0 && expiresInSeconds % 3600 === 0) {
    const hours = expiresInSeconds / 3600;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const minutes = Math.max(1, Math.round(expiresInSeconds / 60));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function renderBodies(
  layout: AuthEmailLayout,
): Omit<AuthEmailContent, "subject"> {
  const url = escapeHtml(layout.actionUrl);

  const html = [
    "<p>TeamMate</p>",
    `<h1>${escapeHtml(layout.heading)}</h1>`,
    `<p>${escapeHtml(layout.introduction)}</p>`,
    `<p><a href="${url}">${escapeHtml(layout.actionLabel)}</a></p>`,
    `<p>${escapeHtml(layout.expiryNotice)}</p>`,
    `<p>${escapeHtml(layout.closingNotice)}</p>`,
  ].join("");

  const text = [
    "TeamMate",
    "",
    layout.heading,
    "",
    layout.introduction,
    "",
    `${layout.actionLabel}:`,
    layout.actionUrl,
    "",
    layout.expiryNotice,
    "",
    layout.closingNotice,
  ].join("\n");

  return { text, html };
}

export function buildVerificationEmailContent(
  actionUrl: string,
): AuthEmailContent {
  return {
    subject: VERIFICATION_EMAIL_SUBJECT,
    ...renderBodies({
      heading: VERIFICATION_EMAIL_SUBJECT,
      introduction:
        "Confirm this email address to finish setting up your TeamMate account.",
      actionLabel: "Verify my email address",
      actionUrl,
      expiryNotice: `This link expires in ${formatExpiry(
        AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      )}.`,
      closingNotice:
        "If you did not create a TeamMate account, you can ignore this message.",
    }),
  };
}

export function buildPasswordResetEmailContent(
  actionUrl: string,
): AuthEmailContent {
  return {
    subject: PASSWORD_RESET_EMAIL_SUBJECT,
    ...renderBodies({
      heading: PASSWORD_RESET_EMAIL_SUBJECT,
      introduction:
        "A password reset was requested for your TeamMate account. Use the link below to choose a new password.",
      actionLabel: "Reset my password",
      actionUrl,
      expiryNotice: `This link expires in ${formatExpiry(
        AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
      )}.`,
      closingNotice:
        "If you did not request a password reset, you can ignore this message and your current password will stay active.",
    }),
  };
}
