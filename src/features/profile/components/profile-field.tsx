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

/**
 * Shared styling for the native `<select>` controls on the profile page.
 *
 * The design system has no select primitive, so this matches the `Input`
 * treatment rather than inventing a one-off look per form. It is declared once
 * so the skill and interest selectors cannot drift apart.
 */
const selectClassName =
  "border-input hover:border-foreground/35 focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-9 w-full rounded-lg border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:ring-[3px]";

/**
 * A native `<select>` wired to {@link ProfileField}.
 *
 * Native semantics are kept deliberately: `<optgroup>` grouping, the platform
 * picker on mobile, and no custom listbox keyboard model to get wrong.
 */
export function ProfileSelect({
  id,
  label,
  error,
  hint,
  hintId,
  registration,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  hintId?: string;
  /** Spread from `react-hook-form`'s `register`, e.g. `register("skillId")`. */
  registration: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <ProfileField
      id={id}
      label={label}
      error={error}
      hint={hint}
      hintId={hintId}
    >
      {({ id: controlId, describedBy, invalid }) => (
        <select
          id={controlId}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={selectClassName}
          {...registration}
        >
          {children}
        </select>
      )}
    </ProfileField>
  );
}
