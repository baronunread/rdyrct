/**
 * The pieces every platform-admin table repeats: the filter row with counts
 * above a long table, the row's "…" trigger, a state said as a dot and a
 * word, and the two-line cell (rdyrct-design, "The app's surfaces").
 */
import type { ReactNode } from "react";
import { Ellipsis } from "@/app/ui/icons";
import { cn } from "../../ui/cn";
import { formatNumber } from "../../lib/numbers";

/**
 * Mutually exclusive filters, each with how many rows it holds. The count is
 * `aria-hidden` so the button's name stays the bare label ("Needs review"),
 * which is what a person says and what a test asks for; the table under it
 * already says how many rows there are.
 */
export function FilterRow<Id extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { id: Id; label: string; count?: number }[];
  value: Id;
  onChange: (id: Id) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex max-w-full min-w-0 gap-0.5 overflow-x-auto px-1"
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
              "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors",
              on
                ? "bg-surface-2 font-semibold text-text"
                : "text-muted [@media(hover:hover)]:hover:text-text",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                aria-hidden
                className={cn("tnum font-medium", on ? "text-muted" : "text-placeholder")}
              >
                {formatNumber(item.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Filters on the left, the search box on the right; stacked on a phone. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

/** The "…" a row's Menu hangs off, the same one the links table uses. */
export function RowMenuTrigger() {
  return (
    <div className="flex justify-end">
      <span className="grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text">
        <Ellipsis size={16} />
      </span>
    </div>
  );
}

const TONE = {
  ok: "text-accent-2",
  warn: "text-butter",
  bad: "text-danger",
  quiet: "text-muted",
} as const;
export type StateTone = keyof typeof TONE;

/** A state as a dot and a word: the colour never says it alone. The word is
 * set in sentence case by CSS, so the stored lowercase word ("suspended",
 * "disabled") stays the row's text. */
export function StateLabel({ tone, children }: { tone: StateTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm whitespace-nowrap", TONE[tone])}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="first-letter:uppercase">{children}</span>
    </span>
  );
}

/** A name in bold over its identifier in mono. Both truncate, with the whole
 * value on hover. */
export function TwoLine({
  title,
  sub,
  titleHint,
  subHint,
}: {
  title: ReactNode;
  sub?: ReactNode;
  titleHint?: string;
  subHint?: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
      <span className="truncate text-sm font-semibold" title={titleHint}>
        {title}
      </span>
      {sub && (
        <span className="truncate font-mono text-xs text-muted" title={subHint}>
          {sub}
        </span>
      )}
    </span>
  );
}
