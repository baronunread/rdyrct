import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { Check, ChevronsUpDown } from "@/app/ui/icons";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export function Menu({
  trigger,
  children,
  align = "start",
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  label?: string;
}) {
  const button = (
    <BaseMenu.Trigger
      className="w-full cursor-pointer"
      nativeButton={false}
      render={<div />}
      aria-label={label}
    >
      {trigger}
    </BaseMenu.Trigger>
  );
  return (
    <BaseMenu.Root>
      {label ? <Tooltip content={label}>{button}</Tooltip> : button}
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align={align} className="z-50">
          {/* Opens at once; only the close animates. Radii nest: 12px popup, 4px padding, 8px items. */}
          <BaseMenu.Popup className="min-w-48 origin-[var(--transform-origin)] rounded-xl bg-surface p-1 smooth-shadow-ring-xl transition-[opacity,scale,filter] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:blur-[4px] data-[starting-style]:transition-none motion-reduce:transition-none">
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
  disabled,
  closeOnClick,
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  closeOnClick?: boolean;
}) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      disabled={disabled}
      closeOnClick={closeOnClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}

export function MenuNote({ children }: { children: ReactNode }) {
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className="max-w-72 px-2.5 py-2 text-xs text-pretty text-muted">
        {children}
      </BaseMenu.GroupLabel>
    </BaseMenu.Group>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function MenuHeader({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className="flex max-w-64 min-w-0 flex-col px-2 pt-2 pb-1.5">
        <span className="truncate text-sm font-semibold text-text">{title}</span>
        {detail && <span className="truncate font-mono text-xs text-muted">{detail}</span>}
      </BaseMenu.GroupLabel>
    </BaseMenu.Group>
  );
}

export function MenuSelect({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const box = cn(
    "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 text-sm transition-colors duration-150 select-none",
    disabled ? "opacity-50" : "hover:border-accent",
    className,
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
