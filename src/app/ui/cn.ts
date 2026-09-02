/** Joins class names, with later Tailwind utilities beating earlier ones.
 * `cn` is variadic, drops falsy values, and takes the clsx object/array
 * forms too. It bundles its own tailwind-merge, ~30x faster than
 * `twMerge` on the render hot path. */
export { cn } from "cn";
