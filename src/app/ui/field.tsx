import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronDown, Info, X } from "@/app/ui/icons";
import { cn } from "./cn";
import { OverflowTip } from "./overflow-tip";
import { Tooltip } from "./tooltip";

// A field that is both invalid and focused keeps the danger ring and takes a danger halo,
// so the mark does not vanish the moment focus lands on it.
const inputClass =
  "h-9 w-full rounded-lg bg-surface px-3 text-sm text-text smooth-shadow-ring-xs transition-[box-shadow] duration-150 placeholder:text-placeholder aria-invalid:shadow-[0_0_0_1.5px_var(--danger)] focus-visible:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)] aria-invalid:focus-visible:shadow-[0_0_0_1.5px_var(--danger),0_0_0_4px_color-mix(in_oklab,var(--danger)_18%,transparent)] focus-visible:outline-none disabled:opacity-50";

const FieldState = createContext<{ invalid: boolean; describedBy?: string; inField: boolean }>({
  invalid: false,
  inField: false,
});

function useFieldAria() {
  const { invalid, describedBy } = useContext(FieldState);
  return invalid ? { "aria-invalid": true, "aria-describedby": describedBy } : {};
}

// The shape that says so without the colour (rdyrct-design: semantic colour never carries
// meaning alone). Place it in a `relative` box around the input; the input needs `pr-8`.
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

// Password managers (Bitwarden, 1Password, LastPass, Dashlane) ignore autocomplete="off"
// and guess from the label, offering the user's own name, email or card for a link title.
// Each reads its own attribute.
export const NO_AUTOFILL = {
  "data-bwignore": true,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;

const autofillProps = (autoComplete: string | undefined) =>
  !autoComplete || autoComplete === "off" ? NO_AUTOFILL : undefined;

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const { invalid, inField } = useContext(FieldState);
    const aria = useFieldAria();
    const input = (
      <input
        ref={ref}
        className={cn(inputClass, invalid && "pr-8", className)}
        {...autofillProps(props.autoComplete)}
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

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed", className)}
    {...autofillProps(props.autoComplete)}
    {...useFieldAria()}
    {...props}
  />
));
Textarea.displayName = "Textarea";

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

export function FieldReason({
  id,
  reason,
  detail,
}: {
  id: string;
  reason: string;
  detail?: string;
}) {
  const longer = detail && detail !== reason ? detail : undefined;
  const row = (
    <span id={id} className="ml-auto flex min-w-0 items-center gap-1 text-danger">
      <X aria-hidden size={11} stroke={2.5} className="shrink-0" />
      {longer ? (
        <span className="truncate">{reason}</span>
      ) : (
        <OverflowTip content={reason}>
          <span className="truncate">{reason}</span>
        </OverflowTip>
      )}
      {longer && <span className="sr-only">. {longer}</span>}
    </span>
  );
  return longer ? <Tooltip content={longer}>{row}</Tooltip> : row;
}

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
  optional?: boolean;
  hint?: ReactNode;
  tip?: string;
  // Rendered inside the label: a link or button here should stop the click
  // from reaching the input if needed.
  aside?: ReactNode;
  error?: string;
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
