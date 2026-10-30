import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, Info, X } from "@/app/ui/icons";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

// Lifted by a ring shadow rather than bordered (rdyrct-design, "The app's
// surfaces"). Invalid draws the danger ring; focus draws the accent ring and
// its soft halo. A field that is both keeps the danger ring and takes a
// danger halo, so the mark does not vanish the moment focus lands on it.
const inputClass =
  "h-9 w-full rounded-lg bg-surface px-3 text-sm text-text smooth-shadow-ring-xs transition-[box-shadow] duration-150 placeholder:text-placeholder aria-invalid:shadow-[0_0_0_1.5px_var(--danger)] focus-visible:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)] aria-invalid:focus-visible:shadow-[0_0_0_1.5px_var(--danger),0_0_0_4px_color-mix(in_oklab,var(--danger)_18%,transparent)] focus-visible:outline-none disabled:opacity-50";

/** What a Field tells the control inside it: whether it is in error, the id
 * of the reason so the control can point at it, and that it sits in a Field
 * at all (which is what gives an Input room for the × mark). */
const FieldState = createContext<{ invalid: boolean; describedBy?: string; inField: boolean }>({
  invalid: false,
  inField: false,
});

/** The ARIA a control inside a Field should carry. */
function useFieldAria() {
  const { invalid, describedBy } = useContext(FieldState);
  return invalid ? { "aria-invalid": true, "aria-describedby": describedBy } : {};
}

/**
 * The × inside a field that is wrong: the shape that says so without the
 * colour (rdyrct-design: semantic colour never carries meaning alone). Place
 * it in a `relative` box around the input; the input needs `pr-8`.
 */
export function InvalidMark({ className }: { className?: string }) {
  return (
    <X
      aria-hidden
      size={15}
      className={cn(
        "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-danger",
        className,
      )}
    />
  );
}

/**
 * A text input. Inside a Field it always sits in its own small box, so the ×
 * can appear when the field is marked without the input moving (it is never
 * remounted, so it keeps focus and what was typed).
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const { invalid, inField } = useContext(FieldState);
    const aria = useFieldAria();
    const input = (
      <input
        ref={ref}
        className={cn(inputClass, invalid && "pr-8", className)}
        {...aria}
        {...props}
      />
    );
    if (!inField) return input;
    return (
      <span className="relative block min-w-0">
        {input}
        {invalid && <InvalidMark />}
      </span>
    );
  },
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

const VALID = { invalid: false, inField: true };

/**
 * The reason a field is wrong, on the right of its label line: a small × and
 * a few words. A longer explanation rides along for screen readers and on
 * hover, so the line itself never wraps and nothing below it moves.
 */
export function FieldReason({
  id,
  reason,
  detail,
}: {
  id: string;
  reason: string;
  detail?: string;
}) {
  return (
    <span
      id={id}
      className="ml-auto flex min-w-0 items-center gap-1 text-danger"
      title={detail ?? reason}
    >
      <X aria-hidden size={11} stroke={2.5} className="shrink-0" />
      <span className="truncate">{reason}</span>
      {detail && detail !== reason && <span className="sr-only">. {detail}</span>}
    </span>
  );
}

/** The label line: the name, its tip, and on the right the reason it is
 * wrong, so an error never pushes the form down. */
function FieldLabelRow({
  label,
  optional,
  tip,
  aside,
  error,
  errorDetail,
  reasonId,
}: {
  label: string;
  optional?: boolean;
  tip?: string;
  aside?: ReactNode;
  error?: string;
  errorDetail?: string;
  reasonId: string;
}) {
  return (
    <span className="mb-1.5 flex min-h-4 items-center gap-1.5 text-xs text-muted">
      <span className="shrink-0">
        {label}
        {optional && <span className="text-placeholder"> · optional</span>}
      </span>
      {tip && <FieldTip label={label} tip={tip} />}
      {error ? (
        <FieldReason id={reasonId} reason={error} detail={errorDetail} />
      ) : (
        aside && <span className="ml-auto">{aside}</span>
      )}
    </span>
  );
}

export function Field({
  label,
  optional,
  hint,
  tip,
  aside,
  error,
  errorDetail,
  className,
  children,
}: {
  label: string;
  /** Adds "· optional" after the label, quietly. */
  optional?: boolean;
  hint?: ReactNode;
  /**
   * Advice about the field, behind an info mark on the label.
   *
   * For the thing worth knowing before you choose but not worth a line of
   * text under every field forever: a tip is read once and then ignored,
   * while a hint is read on every visit and starts to crowd the form.
   */
  tip?: string;
  /** Something small on the right of the label line ("Forgot it?"). An
   * error takes its place while the field is marked. Keep it out of the
   * label's own click target: it is rendered inside the label, so a link or
   * button here should stop the click from reaching the input if needed. */
  aside?: ReactNode;
  /**
   * Why the value is wrong, set after a submit. It sits on the right of the
   * label line, so marking a field never pushes the form down (rdyrct-design,
   * form errors). Keep it short: "Needs https://", "Already taken".
   */
  error?: string;
  /** The longer explanation of `error`, for screen readers and on hover. */
  errorDetail?: string;
  className?: string;
  children: ReactNode;
}) {
  const reasonId = useId();
  const state = error ? { invalid: true, describedBy: reasonId, inField: true } : VALID;
  return (
    <label className={cn("block min-w-0", className)}>
      <FieldLabelRow
        label={label}
        optional={optional}
        tip={tip}
        aside={aside}
        error={error}
        errorDetail={errorDetail}
        reasonId={reasonId}
      />
      <FieldState.Provider value={state}>{children}</FieldState.Provider>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
