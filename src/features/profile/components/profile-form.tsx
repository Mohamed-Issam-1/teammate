"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/components/form-alert";
import { updateProfileAction } from "@/features/profile/actions";
import {
  PROFILE_AVAILABILITY_MAX_HOURS,
  PROFILE_AVAILABILITY_MIN_HOURS,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_HEADLINE_MAX_LENGTH,
  PROFILE_VISIBILITY_VALUES,
  profileFormResolver,
  type ProfileEditFormValues,
  type ProfileEditInput,
} from "@/features/profile/validation";
import type { OwnProfile } from "@/server/profiles/own-profile";

import { ProfileField } from "./profile-field";

const GENERIC_ERROR =
  "We couldn't save your profile right now. Please try again in a moment.";

const VISIBILITY_LABELS: Record<
  (typeof PROFILE_VISIBILITY_VALUES)[number],
  string
> = {
  PRIVATE: "Private — only you can see your profile",
  MEMBERS_ONLY: "Team members — signed-in TeamMate members can see it",
  PUBLIC: "Public — anyone with the link can see it",
};

const fieldError = (
  errors: Partial<Record<keyof ProfileEditFormValues, { message?: string }>>,
  field: keyof ProfileEditFormValues,
): string | undefined => errors[field]?.message;

export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileEditFormValues, unknown, ProfileEditInput>({
    resolver: profileFormResolver,
    defaultValues: {
      displayName: profile.displayName,
      headline: profile.headline ?? "",
      bio: profile.bio ?? "",
      availabilityHoursPerWeek:
        profile.availabilityHoursPerWeek === null
          ? ""
          : String(profile.availabilityHoursPerWeek),
      timezone: profile.timezone ?? "",
      profileVisibility: profile.profileVisibility,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);

    try {
      const result = await updateProfileAction(values);

      if (!result.ok) {
        const submitted = result.fieldErrors;
        let mapped = false;

        if (submitted) {
          for (const [field, messages] of Object.entries(submitted)) {
            const message = messages[0];
            if (message) {
              setError(field as keyof ProfileEditFormValues, {
                type: "server",
                message,
              });
              mapped = true;
            }
          }
        }

        if (!mapped) {
          setServerError(result.message || GENERIC_ERROR);
        }
        return;
      }

      setSaved(true);
    } catch {
      // Never surface a raw framework or database error to the browser.
      setServerError(GENERIC_ERROR);
    }
  });

  return (
    <form className="grid gap-6" method="post" noValidate onSubmit={onSubmit}>
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
      {saved ? (
        <FormAlert tone="success">Your profile has been saved.</FormAlert>
      ) : null}

      <ProfileField
        id="profile-display-name"
        label="Display name"
        error={fieldError(errors, "displayName")}
        hint="This is the name other people see on TeamMate."
        hintId="profile-display-name-hint"
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="text"
            autoComplete="name"
            required
            maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...register("displayName")}
          />
        )}
      </ProfileField>

      <ProfileField
        id="profile-headline"
        label="Headline"
        error={fieldError(errors, "headline")}
        hint={`Optional. A short line about you, up to ${PROFILE_HEADLINE_MAX_LENGTH} characters.`}
        hintId="profile-headline-hint"
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="text"
            autoComplete="off"
            maxLength={PROFILE_HEADLINE_MAX_LENGTH}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...register("headline")}
          />
        )}
      </ProfileField>

      <ProfileField
        id="profile-bio"
        label="Bio"
        error={fieldError(errors, "bio")}
        hint={`Optional. Up to ${PROFILE_BIO_MAX_LENGTH} characters.`}
        hintId="profile-bio-hint"
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            rows={5}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...register("bio")}
          />
        )}
      </ProfileField>

      <ProfileField
        id="profile-availability"
        label="Availability (hours per week)"
        error={fieldError(errors, "availabilityHoursPerWeek")}
        hint={`Optional. A whole number from ${PROFILE_AVAILABILITY_MIN_HOURS} to ${PROFILE_AVAILABILITY_MAX_HOURS}.`}
        hintId="profile-availability-hint"
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={PROFILE_AVAILABILITY_MIN_HOURS}
            max={PROFILE_AVAILABILITY_MAX_HOURS}
            step={1}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...register("availabilityHoursPerWeek")}
          />
        )}
      </ProfileField>

      <ProfileField
        id="profile-timezone"
        label="Time zone"
        error={fieldError(errors, "timezone")}
        hint="Optional. Use an IANA name such as Europe/London."
        hintId="profile-timezone-hint"
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            {...register("timezone")}
          />
        )}
      </ProfileField>

      <ProfileField
        id="profile-visibility"
        label="Profile visibility"
        error={fieldError(errors, "profileVisibility")}
        hint="Who can see your profile."
        hintId="profile-visibility-hint"
      >
        {({ id, describedBy, invalid }) => (
          <select
            id={id}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="border-input hover:border-foreground/35 focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-9 w-full rounded-lg border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:ring-[3px]"
            {...register("profileVisibility")}
          >
            {PROFILE_VISIBILITY_VALUES.map((value) => (
              <option key={value} value={value}>
                {VISIBILITY_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </ProfileField>

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
