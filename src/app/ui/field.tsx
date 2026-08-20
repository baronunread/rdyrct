import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text transition-colors placeholder:text-placeholder focus-visible:border-accent focus-visible:outline-none disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClass, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { wrapperClass?: string }
>(({ className, wrapperClass, ...props }, ref) => (
  <span className={cn("relative block", wrapperClass)}>
    <select
      ref={ref}
      className={cn(inputClass, "cursor-pointer appearance-none pr-7", className)}
      {...props}
    />
    <ChevronDown
      size={14}
      className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
    />
  </span>
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  tip,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /**
   * Advice about the field, behind an info mark on the label.
   *
   * For the thing worth knowing before you choose but not worth a line of
   * text under every field forever: a tip is read once and then ignored,
   * while a hint is read on every visit and starts to crowd the form.
   */
  tip?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs tracking-wider text-muted uppercase">
        {label}
        {tip && (
          <Tooltip content={tip}>
            <button
              type="button"
              aria-label={`About ${label.toLowerCase()}`}
              // A label forwards its clicks to the control it names, which
              // would open the select behind the tooltip.
              onClick={(event) => event.preventDefault()}
              className="cursor-help text-muted normal-case hover:text-text"
            >
              <Info size={13} />
            </button>
          </Tooltip>
        )}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
