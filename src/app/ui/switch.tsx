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
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[checked]:border-accent data-[checked]:bg-accent",
        className,
      )}
    >
      <BaseSwitch.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-text transition-transform data-[checked]:translate-x-[18px] data-[checked]:bg-bg" />
    </BaseSwitch.Root>
  );
}
