/** Joins class names, with later Tailwind utilities beating earlier ones.
 * `twMerge` is already variadic and drops falsy values, so `cn` is just its
 * name in this codebase: no call site passes the object form. */
export { twMerge as cn } from "tailwind-merge";
