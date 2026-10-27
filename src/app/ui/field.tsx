import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, Info } from "@/app/ui/icons";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

// Lifted by a ring shadow rather than bordered (rdyrct-design, "The app's
// surfaces"). Invalid draws the danger ring; focus draws the accent ring and
// its soft halo, and focus wins over invalid so you can see where you are.
const inputClass =
  "h-9 w-full rounded-lg bg-surface px-3 text-sm text-text smooth-shadow-ring-xs transition-[box-shadow] duration-150 placeholder:text-placeholder aria-invalid:shadow-[0_0_0_1.5px_var(--danger)] focus-visible:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)] focus-visible:outline-none disabled:opacity-50";

/** What a Field tells the control inside it: whether it is in error, and the
 * id of the reason, so the control can point at it. */
const FieldState = createContext<{ invalid: boolean; describedBy?: string }>({ invalid: false });

/** The ARIA a control inside a Field should carry. */
function useFieldAria() {
  const { invalid, describedBy } = useContext(FieldState);
  return invalid ? { "aria-invalid": true, "aria-describedby": describedBy } : {};
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClass, className)} {...useFieldAria()} {...props} />
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
      {...useFieldAria()}
      {...props}
    />
    <ChevronDown
      size={14}
      className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
    />
  </span>
));
Select.displayName = "Select";

/** The info mark beside a field's label, with its advice behind a tooltip. */
function FieldTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        aria-label={`About ${label.toLowerCase()}`}
        // A label forwards its clicks to the control it names, which
        // would open the select behind the tooltip.
        onClick={(event) => event.preventDefault()}
        // The mark is 13px; the inset ::after makes it a 25px target.
        className="relative cursor-help text-muted normal-case after:absolute after:-inset-1.5 hover:text-text"
      >
        <Info size={13} />
      </button>
    </Tooltip>
  );
}

const VALID = { invalid: false };

/** The label line: the name, its tip, and on the right the reason it is
 * wrong, so an error never pushes the form down. */
function FieldLabelRow({
  label,
  tip,
  error,
  reasonId,
}: {
  label: string;
  tip?: string;
  error?: string;
  reasonId: string;
}) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
      {label}
      {tip && <FieldTip label={label} tip={tip} />}
      {error && (
        <span id={reasonId} className="ml-auto truncate text-danger" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}

export function Field({
  label,
  hint,
  tip,
  error,
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
  /**
   * Why the value is wrong, set after a submit. It sits on the right of the
   * label line, so marking a field never pushes the form down (rdyrct-design,
   * form errors). Keep it short: "Needs https://", "Already taken".
   */
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const reasonId = useId();
  const state = error ? { invalid: true, describedBy: reasonId } : VALID;
  return (
    <label className={cn("block min-w-0", className)}>
      <FieldLabelRow label={label} tip={tip} error={error} reasonId={reasonId} />
      <FieldState.Provider value={state}>{children}</FieldState.Provider>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
