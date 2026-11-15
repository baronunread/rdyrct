import type { FieldErrors } from "react-hook-form";
import * as v from "valibot";

/** The first react-hook-form field error's message, or a fallback when
 * none of the errors carry one. */
export function firstFormError(errors: FieldErrors, fallback: string): string {
  for (const entry of Object.values(errors)) {
    const message = v.safeParse(v.string(), entry?.message);
    if (message.success && message.output) return message.output;
  }
  return fallback;
}
