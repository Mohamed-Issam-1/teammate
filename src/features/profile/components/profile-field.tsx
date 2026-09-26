"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/**
 * Accessible field wrapper for the profile form.
 *
 * Mirrors the Phase 1 auth field pattern (visible label, `aria-invalid`,
 * `aria-describedby` for hint and error text) while supporting the three control
 * kinds this form needs. Every field is a native, keyboard-operable control; no
 * custom widget is introduced.
 */
export type ProfileFieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  hintId?: string;
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: true | undefined;
  }) => ReactNode;
};

export function ProfileField({
  id,
  label,
  error,
  hint,
  hintId,
  children,
}: ProfileFieldProps) {
  const errorId = `${id}-error`;
  const describedBy =
    [hintId, error ? errorId : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        describedBy,
        invalid: error ? true : undefined,
      })}
      {hint ? (
        <p
          id={hintId}
          className="text-muted-foreground text-xs leading-relaxed"
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-destructive text-sm leading-relaxed"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
