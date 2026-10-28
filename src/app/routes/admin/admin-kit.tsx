/**
 * The pieces every platform-admin table repeats: the filter row with counts
 * above a long table, the row's "…" trigger, a state said as a dot and a
 * word, the two-line cell, and the classes that fold a table into a list on
 * a phone (rdyrct-design, "The app's surfaces").
 */
import type { ReactNode } from "react";
import { Ellipsis } from "@/app/ui/icons";
import { cn } from "../../ui/cn";

const COUNT = new Intl.NumberFormat("en-US");

/** A count in full, with separators: "3,312", never "3.3k". Admin figures
 * are read as figures. */
export const fullNumber = (n: number) => COUNT.format(n);

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
      {items.map((item) => (
        <FilterPill
          key={item.id}
          on={item.id === value}
          label={item.label}
          count={item.count}
          onClick={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}

/** One pill of a FilterRow, for a row that mixes filters with other lists. */
export function FilterPill({
  on,
  label,
  count,
  onClick,
  title,
}: {
  on: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  /** The longer name, on hover, when the label is a short one. */
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
        on
          ? "bg-surface-2 font-semibold text-text"
          : "text-muted [@media(hover:hover)]:hover:text-text",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          aria-hidden
          className={cn("tnum font-medium", on ? "text-muted" : "text-placeholder")}
        >
          {fullNumber(count)}
        </span>
      )}
    </button>
  );
}

/** Filters on the left, the search box on the right; stacked on a phone,
 * search first, since that is what a report sends somebody here to do. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

/**
 * The "…" a row's Menu hangs off. Where there is hover it shows only on the
 * row under the pointer, the row holding focus, or while its menu is open;
 * on a touch screen, which cannot hover, it is always there. The row needs
 * `group/row` (ROW below has it).
 */
export function RowMenuTrigger() {
  return (
    <div className="flex justify-end">
      <span className="grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color,opacity] max-sm:size-10 duration-150 ease-out active:scale-[0.96] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text [@media(hover:hover)]:in-data-[popup-open]:opacity-100">
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
 * set in sentence case by CSS, so a stored lowercase word ("disabled") can be
 * the row's text. */
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

/** An organization's first letter on a quiet tile: what a favicon would be,
 * with no remote image (the CSP allows none). Radii nest with the 28px box. */
export function LetterTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold text-muted uppercase"
    >
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}

/**
 * One table, two shapes. From `sm` up it is a table; on a phone the same
 * rows fold into a list: the first cell and the row's menu share a line,
 * every other cell sits under them as a small labelled fact (its `data-label`),
 * and the header row is kept for screen readers only. One markup, so a test
 * or a screen reader finds the same rows on both.
 *
 * TABLE goes on the `<table>` (through `Table`'s `minWidth`), HEAD on the
 * `<thead>`, ROW on each `<tr>`, and one of MAIN / META / MENU on each cell.
 */
export const PHONE = {
  table: "max-sm:block max-sm:min-w-0",
  head: "max-sm:sr-only",
  body: "max-sm:block",
  row: "group/row max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3 max-sm:shadow-[inset_0_-1px_0_var(--border)]",
  /** The cell that names the row. */
  main: "max-sm:order-0 max-sm:w-[calc(100%-3.5rem)] max-sm:border-0 max-sm:p-0",
  /** The row's menu, top right. */
  menu: "max-sm:order-1 max-sm:ml-auto max-sm:w-10 max-sm:border-0 max-sm:p-0",
  /** A fact under the name, labelled from `data-label`. */
  meta: "max-sm:order-2 max-sm:**:text-xs max-sm:inline-flex max-sm:items-baseline max-sm:gap-1 max-sm:border-0 max-sm:p-0 max-sm:text-left max-sm:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]",
  /** A cell with nothing worth repeating on a phone. */
  hide: "max-sm:hidden",
} as const;

/** The section's name for a screen reader. The page has one visible title,
 * "Platform", and the tab says which section is open; this says it again as
 * a heading, so heading navigation lands on the section too. */
export function SectionHeading({ children }: { children: string }) {
  return <h2 className="sr-only">{children}</h2>;
}
