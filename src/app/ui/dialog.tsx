import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { X } from "@/app/ui/icons";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { cn } from "./cn";

const PHONE = "(max-width: 639px)";
const subscribePhone = (onChange: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** True below the sm breakpoint, where a dialog opens as a bottom sheet. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

/** How wide a dialog gets on a desktop. A phone always gets the full width. */
export type DialogSize = "sm" | "md" | "lg" | "wide" | "xl";
const WIDTHS = {
  sm: "max-w-[420px]",
  md: "max-w-md",
  lg: "max-w-[520px]",
  wide: "max-w-2xl",
  xl: "max-w-[860px]",
} satisfies Record<DialogSize, string>;

/** The title, for a `bare` dialog that lays out its own header. */
export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseDialog.Title className={cn("text-base font-semibold text-balance", className)}>
      {children}
    </BaseDialog.Title>
  );
}

/** The close button, for a `bare` dialog that places its own. */
export function DialogClose({ className }: { className?: string }) {
  return (
    <BaseDialog.Close
      className={cn(
        "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors focus-visible:outline-2 focus-visible:outline-accent [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text",
        className,
      )}
      aria-label="Close"
    >
      <X size={16} />
    </BaseDialog.Close>
  );
}

// Animated with motion, matching the billing overlay: backdrop fade + popup
// fade/scale from 0.95 over 0.2s, on both entry and exit. Base UI's Portal is
// kept mounted so AnimatePresence can play the exit before unmounting.
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
  size,
  bare,
  initialFocus,
  nested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Same as `size="wide"`. */
  wide?: boolean;
  size?: DialogSize;
  /**
   * No padding and no header: the children lay the whole dialog out and
   * place `DialogTitle` and `DialogClose` themselves (the link editor, whose
   * close button sits in its side column). `title` goes unused.
   */
  bare?: boolean;
  /** Where focus goes on open, when not the first control: the typed check
   * of a confirmation, say, rather than its close button. */
  initialFocus?: RefObject<HTMLElement | null>;
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
  // On a phone the dialog is a sheet from the bottom edge, with a handle,
  // so the thumb reaches it (rdyrct-design, "On a phone").
  const phone = usePhone();
  return (
    <LazyMotion features={domAnimation}>
      {/* Under reduced motion the dialog fades but never scales. */}
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {open && (
            <BaseDialog.Root open onOpenChange={onOpenChange}>
              <BaseDialog.Portal keepMounted>
                <BaseDialog.Backdrop
                  className={cn(
                    "fixed inset-0 bg-black/40 backdrop-blur-[2px]",
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
                    "fixed overflow-y-auto overscroll-none bg-surface text-text smooth-shadow-ring-2xl",
                    phone
                      ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[22px] pt-2"
                      : "top-1/2 left-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl",
                    !bare && (phone ? "px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" : "p-6"),
                    nested ? "z-[70]" : "z-50",
                    !phone && WIDTHS[size ?? (wide ? "wide" : "md")],
                  )}
                  initialFocus={initialFocus}
                  render={
                    phone ? (
                      <m.div
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{
                          y: "100%",
                          transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
                        }}
                        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                      />
                    ) : (
                      <m.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        // The way out travels less and ends sooner than the way
                        // in: the dialog's job is done, so it should not hold
                        // the page up.
                        exit={{
                          opacity: 0,
                          scale: 0.98,
                          filter: "blur(4px)",
                          transition: { duration: 0.15 },
                        }}
                        transition={{ duration: 0.2 }}
                      />
                    )
                  }
                >
                  {phone && (
                    <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
                  )}
                  {!bare && (
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <DialogTitle>{title}</DialogTitle>
                      <DialogClose className="-m-1.5" />
                    </div>
                  )}
                  {children}
                </BaseDialog.Popup>
              </BaseDialog.Portal>
            </BaseDialog.Root>
          )}
        </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}
