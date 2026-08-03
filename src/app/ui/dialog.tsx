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
  nested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Bumps this dialog a full stacking level above the default, for one that
   * can open while another Dialog is still open underneath it (e.g. the
   * same-destination match, over the link editor). Without this, both
   * dialogs render at the same z-index, so the top one's own backdrop sits
   * *below* the bottom one's popup instead of dimming/blurring it — leaving
   * the bottom dialog fully sharp and undimmed, which reads wrong, and
   * hiding it outright would just flash the backdrop's blur off and back on
   * as the two dialogs swap. Nested instead keeps both backdrops: the top
   * one's now covers the bottom dialog's popup too, same as it covers the
   * page. */
  nested?: boolean;
}) {
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {open && (
          <BaseDialog.Root open onOpenChange={onOpenChange}>
            <BaseDialog.Portal keepMounted>
              <BaseDialog.Backdrop
                className={cn(
                  "fixed inset-0 bg-black/55 backdrop-blur-[2px]",
                  nested ? "z-[60]" : "z-40",
                )}
                render={
                  <m.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  />
                }
              />
              <BaseDialog.Popup
                className={cn(
                  "fixed top-1/2 left-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-none rounded-xl bg-surface p-6 text-text smooth-shadow-ring-2xl",
                  nested ? "z-[70]" : "z-50",
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
