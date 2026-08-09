import { twMerge, type ClassNameValue } from "tailwind-merge";

/** Joins class names, with later Tailwind utilities beating earlier ones.
 * `twMerge` is already variadic and drops falsy values, so nothing else is
 * needed: no call site passes the object form. */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(inputs);
}
