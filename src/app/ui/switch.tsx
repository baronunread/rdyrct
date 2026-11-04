import type { Ref } from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";

/**
 * A binary toggle. It has no visible text of its own, so pass `label` for
 * the accessible name.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  describedBy,
  disabled,
  className,
  ref,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  /** The id of a line that says more about it, such as a row's hint. */
  describedBy?: string;
  /** Not answerable yet, e.g. while the value it shows is still loading. */
  disabled?: boolean;
  className?: string;
  /** The switch's button, for a dialog that focuses it first. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <BaseSwitch.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn(
        // after: reaches the press target to 28px tall without moving it.
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-2 transition-colors after:absolute after:-inset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[checked]:border-accent data-[checked]:bg-accent data-[disabled]:cursor-default data-[disabled]:opacity-50",
        className,
      )}
    >
      <BaseSwitch.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-text transition-transform data-[checked]:translate-x-[18px] data-[checked]:bg-bg" />
    </BaseSwitch.Root>
  );
}
