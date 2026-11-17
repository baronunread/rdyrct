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

export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

export type DialogSize = "sm" | "md" | "lg" | "wide" | "xl";
const WIDTHS = {
  sm: "max-w-[420px]",
  md: "max-w-md",
  lg: "max-w-[520px]",
  wide: "max-w-2xl",
  xl: "max-w-[860px]",
} satisfies Record<DialogSize, string>;

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseDialog.Title className={cn("text-base font-semibold text-balance", className)}>
      {children}
    </BaseDialog.Title>
  );
}

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

// Base UI's Portal is kept mounted so AnimatePresence can play the exit before unmounting.
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
  wide?: boolean;
  size?: DialogSize;
  bare?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  // Without this both dialogs render at the same z-index, so the top one's backdrop sits below
  // the bottom one's popup and does not dim it. Hiding the bottom one would flash its blur
  // off and back on.
  nested?: boolean;
}) {
  const phone = usePhone();
  return (
    <LazyMotion features={domAnimation}>
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
                    "fixed overscroll-none bg-surface text-text smooth-shadow-ring-2xl",
                    bare ? "overflow-y-auto" : "flex flex-col overflow-hidden",
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
                        // in: the dialog's job is done, so it should not hold the page up.
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
                  {bare ? (
                    children
                  ) : (
                    <>
                      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                        <DialogTitle>{title}</DialogTitle>
                        <DialogClose className="-m-1.5" />
                      </div>
                      {/* py-1 keeps a focus ring at the top or bottom from being cut off. */}
                      <div
                        className={cn(
                          "-my-1 min-h-0 overflow-y-auto overscroll-contain py-1",
                          phone ? "-mx-5 px-5" : "-mx-6 px-6",
                        )}
                      >
                        {children}
                      </div>
                    </>
                  )}
                </BaseDialog.Popup>
              </BaseDialog.Portal>
            </BaseDialog.Root>
          )}
        </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}
