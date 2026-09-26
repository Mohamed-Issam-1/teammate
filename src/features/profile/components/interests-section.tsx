"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormAlert } from "@/features/auth/components/form-alert";
import { createZodResolver } from "@/features/auth/validation";
import {
  addInterestAssignmentAction,
  removeInterestAssignmentAction,
} from "@/features/profile/assignment-actions";
import {
  addInterestAssignmentSchema,
  type AddInterestAssignmentInput,
} from "@/features/profile/assignment-validation";
import type { AssignedInterest } from "@/server/profiles/assignments";
import type { TaxonomyInterest } from "@/server/taxonomy/reads";

import { ProfileSelect } from "./profile-field";

const GENERIC_ERROR =
  "We couldn't update your interests right now. Please try again in a moment.";

export function InterestsSection({
  assignments,
  taxonomy,
}: {
  assignments: readonly AssignedInterest[];
  taxonomy: readonly TaxonomyInterest[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingInterestId, setPendingInterestId] = useState<string | null>(
    null,
  );

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddInterestAssignmentInput, unknown, AddInterestAssignmentInput>({
    resolver: createZodResolver(addInterestAssignmentSchema),
    defaultValues: { interestId: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setNotice(null);

    try {
      const result = await addInterestAssignmentAction(values);

      if (!result.ok) {
        const fieldErrors = result.fieldErrors;
        let mapped = false;

        if (fieldErrors) {
          for (const [field, messages] of Object.entries(fieldErrors)) {
            const message = messages[0];
            if (message) {
              setError(field as keyof AddInterestAssignmentInput, {
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

      setNotice(`${result.data.interestName} added.`);
      reset();
    } catch {
      setServerError(GENERIC_ERROR);
    }
  });

  async function onRemove(interestId: string) {
    setServerError(null);
    setNotice(null);
    setPendingInterestId(interestId);

    try {
      const result = await removeInterestAssignmentAction({ interestId });

      if (!result.ok) {
        setServerError(result.message || GENERIC_ERROR);
        return;
      }

      setNotice("Interest removed.");
    } catch {
      setServerError(GENERIC_ERROR);
    } finally {
      setPendingInterestId(null);
    }
  }

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
        <CardDescription>Profile</CardDescription>
        {/*
          `CardTitle` renders a div, so heading semantics are added explicitly.
          Without them the section title is invisible to heading navigation and
          to screen-reader users moving between sections.
        */}
        <CardTitle
          role="heading"
          aria-level={2}
          className="mt-2 text-xl font-semibold tracking-tight"
        >
          Interests
        </CardTitle>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          Interests are maintained by TeamMate. You choose which ones apply to
          you.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5 px-5 pb-5 sm:px-6 sm:pb-6">
        {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            You have not added any interests yet.
          </p>
        ) : (
          <ul className="grid gap-3">
            {assignments.map((assignment) => (
              <li
                key={assignment.interestId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <span className="text-sm font-medium">{assignment.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingInterestId === assignment.interestId}
                  aria-busy={pendingInterestId === assignment.interestId}
                  onClick={() => onRemove(assignment.interestId)}
                >
                  {pendingInterestId === assignment.interestId
                    ? "Removing…"
                    : `Remove ${assignment.name}`}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {taxonomy.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            Interests are not available right now. Please try again later.
          </p>
        ) : (
          <form
            className="grid gap-4 border-t pt-5"
            method="post"
            noValidate
            onSubmit={onSubmit}
          >
            <ProfileSelect
              id="interest-select"
              label="Add an interest"
              error={errors.interestId?.message}
              registration={register("interestId")}
            >
              <option value="">Select an interest</option>
              {taxonomy.map((interest) => (
                <option key={interest.id} value={interest.id}>
                  {interest.name}
                </option>
              ))}
            </ProfileSelect>

            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Adding…" : "Add interest"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
