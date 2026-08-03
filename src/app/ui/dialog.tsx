import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { cn } from "./cn";

// Animated with motion, matching the billing overlay: backdrop fade + popup
// fade/scale from 0.95 over 0.2s, on both entry and exit. Base UI's Portal is
// kept mounted so AnimatePresence can play the exit before unmounting.
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
  hideBackdrop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Skips this dialog's own backdrop: for a dialog left open underneath
   * another one (e.g. the same-destination match), so the two don't stack
   * into a double-dark overlay. The dialog above still darkens this one, via
   * its own backdrop. */
  hideBackdrop?: boolean;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {open && (
          <BaseDialog.Root open onOpenChange={onOpenChange}>
            <BaseDialog.Portal keepMounted>
              {!hideBackdrop && (
                <BaseDialog.Backdrop
                  className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
                  render={
                    <m.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    />
                  }
                />
              )}
              <BaseDialog.Popup
                className={cn(
                  "fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-none rounded-xl border border-border bg-surface p-6 text-text shadow-2xl",
                  wide ? "max-w-2xl" : "max-w-md",
                )}
                render={
                  <m.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  />
                }
              >
                <div className="mb-4 flex items-center justify-between">
                  <BaseDialog.Title className="text-base font-bold">{title}</BaseDialog.Title>
                  <BaseDialog.Close
                    className="cursor-pointer rounded p-1 text-muted hover:text-text"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </BaseDialog.Close>
                </div>
                {children}
              </BaseDialog.Popup>
            </BaseDialog.Portal>
          </BaseDialog.Root>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
