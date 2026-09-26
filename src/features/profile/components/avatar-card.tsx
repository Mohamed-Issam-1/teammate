"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormAlert } from "@/features/auth/components/form-alert";
import { deleteAvatar, uploadAvatar } from "@/features/profile/avatar-client";
import {
  MAX_AVATAR_UPLOAD_BYTES,
  AVATAR_ACCEPTED_INPUT,
} from "@/features/profile/avatar-constants";

import { AvatarFallback, initialsOf } from "./avatar-image";

/**
 * Own-avatar management.
 *
 * A separate card rather than another field in the profile-details form, so an
 * upload in progress or a failed upload cannot disturb the text fields or their
 * pending state, and the two concerns stay independently understandable.
 *
 * There is no URL textbox and no storage token anywhere in this UI: the only input
 * is a file, and the resulting `avatarUrl` is whatever the server chose.
 */

const MAX_SIZE_LABEL = `${Math.floor(MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024))} MB`;

export function AvatarCard({
  avatarUrl,
  displayName,
}: {
  /** The server-owned avatar path for the current viewer, or `null`. */
  avatarUrl: string | null;
  displayName: string;
}) {
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(
    avatarUrl,
  );
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = inputRef.current;
    const file = input?.files?.[0];

    if (!input || !file) {
      setError("Choose an image to upload.");
      setNotice(null);
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const result = await uploadAvatar(file);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setCurrentAvatarUrl(result.avatarUrl);
      setNotice(
        avatarUrl === null
          ? "Your avatar has been uploaded."
          : "Your avatar has been replaced.",
      );
    } finally {
      setPending(false);
      // Clear the control so re-picking the same file fires a change event.
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function onRemove() {
    setRemoving(true);
    setError(null);
    setNotice(null);

    try {
      const result = await deleteAvatar();

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setCurrentAvatarUrl(null);
      setNotice("Your avatar has been removed.");
    } finally {
      setRemoving(false);
    }
  }

  const hasAvatar = currentAvatarUrl !== null;
  const busy = pending || removing;

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
        <CardDescription>Profile</CardDescription>
        <CardTitle
          role="heading"
          aria-level={2}
          className="mt-2 text-xl font-semibold tracking-tight"
        >
          Avatar
        </CardTitle>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          Your avatar is shown wherever your profile is visible.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5 px-5 pb-5 sm:px-6 sm:pb-6">
        {/*
          The alert carries `role="alert"`, so it is announced when it appears. It
          is wrapped only so the file input can point at the same node through
          `aria-describedby`; a second visually hidden copy of the message would
          make a screen reader announce it twice.
        */}
        <div id="avatar-file-error">
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        </div>
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

        <div className="flex items-center gap-4">
          {hasAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- authorized per-viewer bytes must not pass through a shared optimizer cache
            <img
              src={currentAvatarUrl}
              alt={`${displayName}'s avatar`}
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="size-14 shrink-0 rounded-full border object-cover"
            />
          ) : (
            <AvatarFallback initials={initialsOf(displayName)} />
          )}

          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-1.5">
              {/*
                Deliberately a different accessible name from the submit button
                below. When both were called "Upload avatar", a screen-reader user
                heard two identically named controls, and the file input was
                announced as a button because its role comes from the type.
              */}
              <Label htmlFor="avatar-file">
                {hasAvatar ? "Choose a replacement image" : "Choose an image"}
              </Label>
              <Input
                ref={inputRef}
                id="avatar-file"
                name="avatar"
                type="file"
                accept={AVATAR_ACCEPTED_INPUT}
                disabled={busy}
                aria-describedby={
                  error === null
                    ? "avatar-file-help"
                    : "avatar-file-help avatar-file-error"
                }
                aria-invalid={error !== null}
                className="w-full max-w-xs"
              />
              <p
                id="avatar-file-help"
                className="text-muted-foreground text-xs"
              >
                JPEG, PNG, or WebP. Up to {MAX_SIZE_LABEL}. Stored as WebP, at
                most 512 by 512 pixels.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy} aria-busy={pending}>
                {pending
                  ? "Uploading…"
                  : hasAvatar
                    ? "Replace avatar"
                    : "Upload avatar"}
              </Button>
              {hasAvatar ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-busy={removing}
                  onClick={onRemove}
                >
                  {removing ? "Removing…" : "Remove avatar"}
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
