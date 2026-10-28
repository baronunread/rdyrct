import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Command as CommandPrimitive } from "cmdk";
import { useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { AnimatePresence, domAnimation, LazyMotion, m, MotionConfig } from "motion/react";
import { IconSearch } from "@tabler/icons-react";
import { Kbd } from "../ui/kbd";
import { cn } from "../ui/cn";

/**
 * The ⌘K palette's own frame, as the redesign mock draws it: a 640px panel
 * near the top of the page on a desktop, a sheet with a handle from the
 * bottom edge on a phone (rdyrct-design, "On a phone"). cmdk does the
 * keyboard work; everything it shows is styled here so the rows, the icon
 * tiles and the key footer stay one design.
 */

const PHONE = "(max-width: 639px)";
const subscribePhone = (onChange: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

const EASE = [0.32, 0.72, 0, 1] as const;

export function CommandSheet({
  open,
  onOpenChange,
  label,
  value,
  onValueChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name; not shown. */
  label: string;
  /** The highlighted row's value. */
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
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
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                  render={
                    <m.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                      transition={{ duration: 0.15 }}
                    />
                  }
                />
                <BaseDialog.Popup
                  data-command-menu
                  className={cn(
                    "fixed z-50 flex flex-col overflow-hidden bg-surface text-text smooth-shadow-ring-2xl",
                    phone
                      ? "inset-x-0 bottom-0 max-h-[80dvh] rounded-t-[22px] pb-[env(safe-area-inset-bottom)]"
                      : "top-24 left-1/2 max-h-[min(36rem,calc(100dvh-8rem))] w-[calc(100vw-2rem)] max-w-[640px] -translate-x-1/2 rounded-2xl",
                  )}
                  render={
                    phone ? (
                      <m.div
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%", transition: { duration: 0.2, ease: EASE } }}
                        transition={{ duration: 0.3, ease: EASE }}
                      />
                    ) : (
                      <m.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        // Opened many times a session, so it leaves faster
                        // than it came, with a little blur and no travel.
                        exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
                        transition={{ duration: 0.15 }}
                      />
                    )
                  }
                >
                  {phone && (
                    <div
                      aria-hidden
                      className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border"
                    />
                  )}
                  <BaseDialog.Title className="sr-only">{label}</BaseDialog.Title>
                  <CommandPrimitive
                    label={label}
                    shouldFilter={false}
                    value={value}
                    onValueChange={onValueChange}
                    className="flex min-h-0 flex-1 flex-col"
                  >
                    {children}
                  </CommandPrimitive>
                </BaseDialog.Popup>
              </BaseDialog.Portal>
            </BaseDialog.Root>
          )}
        </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}

/** The search line: icon, field, an optional scope pill before the field and
 * the result count after it. */
export function PaletteInput({
  pill,
  count,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input> & { pill?: ReactNode; count?: number }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-[18px] shadow-[inset_0_-1px_0_var(--border)]">
      <IconSearch aria-hidden size={17} stroke={1.75} className="shrink-0 text-muted" />
      {pill}
      <CommandPrimitive.Input
        {...props}
        // The global :focus-visible rule (styles.css) is unlayered, so it
        // beats an `outline-none` utility. The panel is the focus indicator.
        style={{ outline: "none" }}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-text placeholder:text-placeholder"
      />
      {count !== undefined && (
        <span aria-live="polite" className="shrink-0 text-xs text-muted tabular-nums">
          {count === 1 ? "1 result" : `${count} results`}
        </span>
      )}
    </div>
  );
}

export function PaletteList({ children }: { children: ReactNode }) {
  return (
    <CommandPrimitive.List className="min-h-0 flex-1 scroll-py-1.5 overflow-x-hidden overflow-y-auto overscroll-contain p-1.5">
      {children}
    </CommandPrimitive.List>
  );
}

export function PaletteEmpty({ children }: { children: ReactNode }) {
  return (
    <CommandPrimitive.Empty className="px-3 py-8 text-center text-sm text-muted">
      {children}
    </CommandPrimitive.Empty>
  );
}

export function PaletteGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted"
    >
      {children}
    </CommandPrimitive.Group>
  );
}

/** A 40px row (44px on a phone): tile, label, and whatever sits at its end. */
export function PaletteItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      {...props}
      className={cn(
        "flex h-11 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-text outline-none select-none sm:h-10",
        "data-[selected=true]:bg-surface-2 data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50",
        className,
      )}
    />
  );
}

/** The icon's tile: 26px, paper-coloured, so a row reads by its shape. */
export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-bg text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "G D" as two keys, the hint at the end of a row. Not on a phone, which
 * has no keys to press. */
export function RowKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span aria-hidden className="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

/** The keys that work here, once, at the bottom. A phone has no keyboard, so
 * it has no footer. */
export function PaletteFooter() {
  return (
    <div
      aria-hidden
      className="hidden shrink-0 items-center gap-4 px-4 py-2.5 text-xs text-muted shadow-[inset_0_1px_0_var(--border)] sm:flex"
    >
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> to move
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd> to open
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>esc</Kbd> to close
      </span>
    </div>
  );
}

/** Each word of `query` in the accent wherever it appears in `text`. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;
  const lower = text.toLowerCase();
  const marked = Array.from({ length: text.length }, () => false);
  for (const word of words) {
    let at = lower.indexOf(word);
    while (at !== -1) {
      for (let i = at; i < at + word.length; i++) marked[i] = true;
      at = lower.indexOf(word, at + word.length);
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      const chunk = text.slice(start, i);
      parts.push(
        marked[start] ? (
          <mark key={start} className="bg-transparent font-semibold text-accent">
            {chunk}
          </mark>
        ) : (
          chunk
        ),
      );
      start = i;
    }
  }
  return parts;
}
