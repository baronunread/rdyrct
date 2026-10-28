import { useRef } from "react";
import { cn } from "./cn";
import { useScrollFade } from "./scroll-fade";

/**
 * A row of filters with their counts ("All 199 · Needs attention 3"), the
 * filter row rdyrct-design puts above a long table. One is always on.
 *
 * Pressed buttons rather than tabs: each narrows the same table below
 * rather than swapping in a different panel. On a phone the row scrolls
 * sideways instead of wrapping, so the table never moves down a line.
 */
export function FilterChips<Id extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly { id: Id; label: string; count?: number }[];
  value: Id;
  onChange: (id: Id) => void;
  label: string;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  useScrollFade(row);
  return (
    <div
      ref={row}
      role="group"
      aria-label={label}
      className={cn(
        "-mx-1 flex min-w-0 gap-0.5 overflow-x-auto overscroll-x-none px-1 [scrollbar-width:none]",
        className,
      )}
    >
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent",
              on
                ? "bg-surface-2 font-semibold text-text"
                : "text-muted [@media(hover:hover)]:hover:text-text",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn("tnum font-medium", on ? "text-muted" : "text-placeholder")}>
                {item.count.toLocaleString("en-US")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
