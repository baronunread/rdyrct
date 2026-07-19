import { OTPField } from "@base-ui/react/otp-field";
import { cn } from "./cn";

/**
 * Segmented one-time-code input (the modern boxed style). Wraps Base UI's
 * OTPField: numeric validation, paste-to-fill, and arrow-key nav come for
 * free. `onComplete` fires once the last slot is filled.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus,
  disabled,
  onComplete,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  onComplete?: (value: string) => void;
  className?: string;
}) {
  return (
    <OTPField.Root
      length={length}
      value={value}
      disabled={disabled}
      autoComplete="one-time-code"
      onValueChange={(next) => {
        onChange(next);
        if (next.length === length) onComplete?.(next);
      }}
      className={cn("flex gap-2", className)}
    >
      {Array.from({ length }).map((_, i) => (
        <OTPField.Input
          key={i}
          autoFocus={autoFocus && i === 0}
          className="h-11 w-full min-w-0 rounded-md border border-border bg-bg text-center text-lg text-text tabular-nums transition-colors focus:border-accent focus:outline-none disabled:opacity-50 data-[filled]:border-accent/60"
        />
      ))}
    </OTPField.Root>
  );
}
