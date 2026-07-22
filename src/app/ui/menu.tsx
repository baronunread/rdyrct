import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "./cn";

export function Menu({
  trigger,
  children,
  align = "start",
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  /** Names an icon-only trigger (aria-label + tooltip). */
  label?: string;
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        className="w-full cursor-pointer"
        nativeButton={false}
        render={<div />}
        aria-label={label}
        title={label}
      >
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align={align} className="z-50">
          <BaseMenu.Popup className="min-w-48 rounded-lg border border-border bg-surface p-1 shadow-xl transition-[opacity,scale] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function MenuItem({
  onClick,
  children,
  className,
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none data-[highlighted]:bg-surface-2",
        className,
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1 h-px bg-border" />;
}

/**
 * A form picker with the org-switcher look: an input-sized bordered trigger
 * with a chevron, and a dropdown whose items check-mark the current value.
 * Use inside `Field` in place of the native `Select` from ./field.
 */
export function MenuSelect({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** aria-label for the trigger (Field's <label> can't label a menu button) */
  label: string;
  disabled?: boolean;
}) {
  const box = cn(
    "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 text-sm transition-colors select-none",
    disabled ? "opacity-50" : "hover:border-accent",
  );
  const face = (
    <>
      <span className="truncate">{options.find((o) => o.value === value)?.label}</span>
      <ChevronsUpDown size={14} className="shrink-0 text-muted" />
    </>
  );
  if (disabled)
    return (
      <div className={box} aria-label={label} aria-disabled="true">
        {face}
      </div>
    );
  return (
    <Menu label={label} trigger={<div className={box}>{face}</div>}>
      {options.map((o) => (
        <MenuItem key={o.value} onClick={() => onChange(o.value)}>
          <span className="w-4">
            {o.value === value && <Check size={13} className="text-accent" />}
          </span>
          <span className="truncate">{o.label}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
