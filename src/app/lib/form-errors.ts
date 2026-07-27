import type { FieldErrors } from "react-hook-form";

/** The first react-hook-form field error's message, or a fallback when
 * none of the errors carry one. */
export function firstFormError(errors: FieldErrors, fallback: string): string {
  const firstError = Object.values(errors).find((entry) => entry?.message);
  return typeof firstError?.message === "string" ? firstError.message : fallback;
}
