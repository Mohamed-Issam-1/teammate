import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import { z, type ZodType } from "zod";

export const AUTH_EMAIL_MAX_LENGTH = 254;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("Enter a valid email address.")
      .max(AUTH_EMAIL_MAX_LENGTH, "Email address is too long."),
  );

const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(
    AUTH_PASSWORD_MAX_LENGTH,
    `Use no more than ${AUTH_PASSWORD_MAX_LENGTH} characters.`,
  );

const signInPasswordSchema = z
  .string()
  .min(1, "Enter your password.")
  .max(
    AUTH_PASSWORD_MAX_LENGTH,
    `Use no more than ${AUTH_PASSWORD_MAX_LENGTH} characters.`,
  );

export const signUpSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter at least 2 characters.")
      .max(80, "Use no more than 80 characters."),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email: emailSchema,
  password: signInPasswordSchema,
});

export const emailOnlySchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignUpValues = z.output<typeof signUpSchema>;
export type SignInValues = z.output<typeof signInSchema>;
export type EmailOnlyValues = z.output<typeof emailOnlySchema>;
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>;

/**
 * Small React Hook Form resolver for the installed Zod version. This keeps the
 * existing dependency set unchanged while still normalizing values before they
 * reach a Better Auth client method.
 */
export function createZodResolver<Input extends FieldValues, Output>(
  schema: ZodType<Output, Input>,
): Resolver<Input, unknown, Output> {
  return async (values) => {
    const result = schema.safeParse(values);

    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      const message = issue.message;

      if (typeof field === "string" && !(field in errors)) {
        errors[field] = { type: issue.code, message };
        continue;
      }

      if (typeof field !== "string" && !("root" in errors)) {
        errors.root = { type: issue.code, message };
      }
    }

    return {
      values: {},
      errors: errors as unknown as FieldErrors<Input>,
    };
  };
}

export function getSingleSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function hasUsableResetToken(
  value: string | undefined,
): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
