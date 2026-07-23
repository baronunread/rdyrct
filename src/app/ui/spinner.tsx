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

/**
 * Wraps a button label and transitions it to a spinner on busy: the text
 * blurs then shrinks away while the spinner fades in a moment later. The
 * text stays in the DOM (invisible during busy) so the button does not
 * shrink.
 */
export function BusyContent({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className="busy-label" data-busy={busy ? "" : undefined}>
        {children}
      </span>
      <span
        className="busy-spinner absolute inset-0 flex items-center justify-center pointer-events-none"
        data-busy={busy ? "" : undefined}
        aria-hidden
      >
        <Spinner />
      </span>
    </span>
  );
}
