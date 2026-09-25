import type { UseFormRegisterReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AuthFormFieldProps = {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  maxLength: number;
  inputMode?: "email" | "text";
  description?: string;
  descriptionId?: string;
};

export function AuthFormField({
  id,
  label,
  registration,
  error,
  type,
  autoComplete,
  maxLength,
  inputMode,
  description,
  descriptionId,
}: AuthFormFieldProps) {
  const errorId = `${id}-error`;
  const describedBy =
    [descriptionId, error ? errorId : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...registration}
      />
      {description ? (
        <p
          id={descriptionId}
          className="text-muted-foreground text-xs leading-relaxed"
        >
          {description}
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
