import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps, ReactNode } from "react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { Search } from "@/app/ui/icons";
import { cn } from "./cn";

/**
 * Command palette primitives: cmdk wearing the app's tokens. Same split as
 * shadcn's command.tsx, but the dialog shell is our own base-ui + motion one,
 * so the backdrop, blur, fade and z-index match every other Dialog rather
 * than pulling in a second dialog implementation.
 */

export function CommandDialog({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the palette; not shown. */
  label: string;
  children: ReactNode;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {open && (
          <BaseDialog.Root open onOpenChange={onOpenChange}>
            <BaseDialog.Portal keepMounted>
              <BaseDialog.Backdrop
                className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
                render={
                  <m.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  />
                }
              />
              <BaseDialog.Popup
                className="fixed top-[14dvh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl bg-surface text-text smooth-shadow-ring-2xl"
                render={
                  <m.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  />
                }
              >
                <BaseDialog.Title className="sr-only">{label}</BaseDialog.Title>
                <CommandPrimitive label={label} className="flex max-h-[60dvh] flex-col">
                  {children}
                </CommandPrimitive>
              </BaseDialog.Popup>
            </BaseDialog.Portal>
          </BaseDialog.Root>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

export function CommandInput(props: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-4">
      <Search size={16} className="shrink-0 text-muted" />
      <CommandPrimitive.Input
        {...props}
        className="h-12 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-placeholder"
      />
    </div>
  );
}

export function CommandList(props: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      {...props}
      className="scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1"
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty {...props} className="px-3 py-6 text-center text-sm text-muted" />;
}

export function CommandGroup(props: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      {...props}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      {...props}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text outline-none select-none",
        "data-[selected=true]:bg-surface-2 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
    />
  );
}
