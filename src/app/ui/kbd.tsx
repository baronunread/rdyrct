import type { ReactNode } from "react";
import { cn } from "./cn";

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
