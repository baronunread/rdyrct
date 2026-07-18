import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function Menu({
  trigger,
  children,
  align = "start",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className="w-full cursor-pointer" nativeButton={false} render={<div />}>
        {trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align={align} className="z-50">
          <BaseMenu.Popup className="min-w-48 rounded-lg border border-border bg-surface p-1 shadow-xl transition-[opacity,transform] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
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
        "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text outline-none data-[highlighted]:bg-surface-2",
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
