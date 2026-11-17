import type { FieldErrors } from "react-hook-form";
import * as v from "valibot";

export function firstFormError(errors: FieldErrors, fallback: string): string {
  for (const entry of Object.values(errors)) {
    const message = v.safeParse(v.string(), entry?.message);
    if (message.success && message.output) return message.output;
  }
  return fallback;
}
