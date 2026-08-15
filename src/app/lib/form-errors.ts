import type { FieldErrors } from "react-hook-form";

/** The first react-hook-form field error's message, or a fallback when
 * none of the errors carry one. */
export function firstFormError(errors: FieldErrors, fallback: string): string {
  for (const entry of Object.values(errors)) {
    if (entry?.message) return String(entry.message);
  }
  return fallback;
}
