"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  removeSkillAssignmentAction,
  saveSkillAssignmentAction,
} from "@/features/profile/assignment-actions";
import {
  PROFICIENCY_LEVELS as PROFICIENCY_OPTIONS,
  saveSkillAssignmentSchema,
  type SaveSkillAssignmentFormValues,
} from "@/features/profile/assignment-validation";
import type { AssignedSkill } from "@/server/profiles/assignments";
import type { TaxonomySkill } from "@/server/taxonomy/reads";

import { ProfileField, ProfileSelect } from "./profile-field";

const GENERIC_ERROR =
  "We couldn't update your skills right now. Please try again in a moment.";

const PROFICIENCY_LABELS: Record<string, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  EXPERT: "Expert",
};

/** Group skills by category for an accessible native optgroup select. */
function groupSkills(skills: readonly TaxonomySkill[]) {
  const groups = new Map<string, TaxonomySkill[]>();

  for (const skill of skills) {
    const key = skill.category ?? "Other";
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(skill);
    } else {
      groups.set(key, [skill]);
    }
  }

  return [...groups.entries()];
}

export function SkillsSection({
  assignments,
  taxonomy,
}: {
  assignments: readonly AssignedSkill[];
  taxonomy: readonly TaxonomySkill[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<
    SaveSkillAssignmentFormValues,
    unknown,
    SaveSkillAssignmentFormValues
  >({
    resolver: createZodResolver(saveSkillAssignmentSchema),
    defaultValues: {
      skillId: "",
      proficiencyLevel: "BEGINNER",
      yearsExperience: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setNotice(null);

    try {
      const result = await saveSkillAssignmentAction(values);

      if (!result.ok) {
        const fieldErrors = result.fieldErrors;
        let mapped = false;

        if (fieldErrors) {
          for (const [field, messages] of Object.entries(fieldErrors)) {
            const message = messages[0];
            if (message) {
              setError(field as keyof SaveSkillAssignmentFormValues, {
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

      setNotice(
        result.data.updated
          ? `Updated ${result.data.skillName}.`
          : `Added ${result.data.skillName}.`,
      );
      reset();
    } catch {
      setServerError(GENERIC_ERROR);
    }
  });

  async function onRemove(skillId: string) {
    setServerError(null);
    setNotice(null);
    setPendingSkillId(skillId);

    try {
      const result = await removeSkillAssignmentAction({ skillId });

      if (!result.ok) {
        setServerError(result.message || GENERIC_ERROR);
        return;
      }

      setNotice("Skill removed.");
    } catch {
      setServerError(GENERIC_ERROR);
    } finally {
      setPendingSkillId(null);
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
          Skills
        </CardTitle>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          Skills are maintained by TeamMate. You choose which ones apply to you.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5 px-5 pb-5 sm:px-6 sm:pb-6">
        {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            You have not added any skills yet.
          </p>
        ) : (
          <ul className="grid gap-3">
            {assignments.map((assignment) => (
              <li
                key={assignment.skillId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="grid gap-0.5">
                  <span className="text-sm font-medium">{assignment.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {PROFICIENCY_LABELS[assignment.proficiencyLevel] ??
                      assignment.proficiencyLevel}
                    {assignment.yearsExperience === null
                      ? ""
                      : ` · ${assignment.yearsExperience} yr`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingSkillId === assignment.skillId}
                  aria-busy={pendingSkillId === assignment.skillId}
                  onClick={() => onRemove(assignment.skillId)}
                >
                  {pendingSkillId === assignment.skillId
                    ? "Removing…"
                    : `Remove ${assignment.name}`}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {taxonomy.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            Skills are not available right now. Please try again later.
          </p>
        ) : (
          <form
            className="grid gap-4 border-t pt-5"
            method="post"
            noValidate
            onSubmit={onSubmit}
          >
            <ProfileSelect
              id="skill-select"
              label="Add or update a skill"
              error={errors.skillId?.message}
              hint="Selecting a skill you already have will update it."
              hintId="skill-select-hint"
              registration={register("skillId")}
            >
              <option value="">Select a skill</option>
              {groupSkills(taxonomy).map(([category, skills]) => (
                <optgroup key={category} label={category}>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </ProfileSelect>

            <ProfileSelect
              id="skill-proficiency"
              label="Proficiency"
              error={errors.proficiencyLevel?.message}
              registration={register("proficiencyLevel")}
            >
              {PROFICIENCY_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {PROFICIENCY_LABELS[level]}
                </option>
              ))}
            </ProfileSelect>

            <ProfileField
              id="skill-years"
              label="Years of experience"
              error={errors.yearsExperience?.message}
              hint="Optional. A whole number from 0 to 100."
              hintId="skill-years-hint"
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min={0}
                  max={100}
                  step={1}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  {...register("yearsExperience")}
                />
              )}
            </ProfileField>

            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Saving…" : "Save skill"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
