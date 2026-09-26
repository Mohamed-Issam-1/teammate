"use client";

/**
 * Browser client for the own-avatar endpoint.
 *
 * The upload goes to the dedicated multipart route rather than a Server Action,
 * because a Server Action's body limit sits far below the 4 MiB this endpoint
 * accepts, and raising it globally would relax it for every action in the
 * application to serve one endpoint.
 *
 * Errors are surfaced as the server's own bounded messages. A raw network or
 * parsing failure collapses into one generic line, so nothing unexpected ever
 * reaches the UI.
 */

const ENDPOINT = "/api/profile/avatar";

export type AvatarRequestResult =
  { ok: true; avatarUrl: string | null } | { ok: false; message: string };

const GENERIC_ERROR =
  "We couldn't update your avatar right now. Please try again in a moment.";

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "object" &&
      (body as { error: unknown }).error !== null &&
      typeof (body as { error: { message?: unknown } }).error.message ===
        "string"
    ) {
      return (body as { error: { message: string } }).error.message;
    }
  } catch {
    // A non-JSON body is treated as an unexpected failure below.
  }

  return GENERIC_ERROR;
}

export async function uploadAvatar(file: File): Promise<AvatarRequestResult> {
  let response: Response;

  try {
    const form = new FormData();
    form.append("file", file);

    response = await fetch(ENDPOINT, {
      method: "POST",
      body: form,
      // No `Content-Type` header: the browser must set the multipart boundary.
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  try {
    const body: unknown = await response.json();

    if (
      typeof body === "object" &&
      body !== null &&
      "avatarUrl" in body &&
      typeof (body as { avatarUrl: unknown }).avatarUrl === "string"
    ) {
      return { ok: true, avatarUrl: (body as { avatarUrl: string }).avatarUrl };
    }
  } catch {
    // Fall through to the generic failure.
  }

  return { ok: false, message: GENERIC_ERROR };
}

export async function deleteAvatar(): Promise<AvatarRequestResult> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true, avatarUrl: null };
}
