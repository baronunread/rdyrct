import { cn } from "./cn";

/**
 * Inline busy indicator for in-flight buttons: sized to sit where the label
 * was, drawn in the button's own text color. Page-level loading states use
 * the skeletons in `components/skeletons.tsx`, not this.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
