import { z } from "zod";

export const ONBOARDING_DISPLAY_NAME_MIN_LENGTH = 2;
export const ONBOARDING_DISPLAY_NAME_MAX_LENGTH = 80;

export const onboardingInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(ONBOARDING_DISPLAY_NAME_MIN_LENGTH, "Enter at least 2 characters.")
      .max(
        ONBOARDING_DISPLAY_NAME_MAX_LENGTH,
        "Use no more than 80 characters.",
      )
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/u.test(value),
        "Use printable characters only.",
      ),
  })
  .strict();

export type OnboardingInput = z.output<typeof onboardingInputSchema>;
