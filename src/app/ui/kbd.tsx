import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A key, as shadcn/ui draws one (ui.shadcn.com/docs/components/kbd): its own
 * small filled box, in the sans, so a shortcut reads as keys on a keyboard
 * rather than a code fragment. Each key of a chord gets a box (`Shortcut`).
 *
 * `tone` follows what it sits on: the page and menus, a tooltip (already on
 * surface-2), or a primary button (on the accent).
 */
export function Kbd({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "tooltip" | "primary";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-sans text-xs font-medium select-none",
        tone === "default" && "bg-surface-2 text-muted",
        tone === "tooltip" && "bg-bg text-muted",
        tone === "primary" && "bg-bg/20 text-current",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** ⌘ on a Mac (and iPad with a keyboard), Ctrl everywhere else, where the
 * command menu listens for Ctrl+K and ⌘ means nothing. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** A chord as separate keys: `<Shortcut keys={[MOD_KEY, "K"]} />`. Hidden
 * from screen readers; the control it sits in carries the name. */
export function Shortcut({
  keys,
  tone,
  className,
}: {
  keys: string[];
  tone?: "default" | "tooltip" | "primary";
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {keys.map((key) => (
        <Kbd key={key} tone={tone}>
          {key}
        </Kbd>
      ))}
    </span>
  );
}
