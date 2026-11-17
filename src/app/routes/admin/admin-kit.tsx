import type { ReactNode } from "react";
import { Ellipsis } from "@/app/ui/icons";
import { cn } from "../../ui/cn";
import { StableLabel } from "../../ui/stable-label";
import { OverflowTip } from "@/app/ui/overflow-tip";
import { Tooltip } from "@/app/ui/tooltip";

const COUNT = new Intl.NumberFormat("en-US");

export const fullNumber = (n: number) => COUNT.format(n);

/** The count is aria-hidden so the button's name stays the bare label. */
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
  title?: string;
}) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        aria-pressed={on}
        onClick={onClick}
        className={cn(
          "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
          on
            ? "bg-surface-2 font-semibold text-text"
            : "text-muted [@media(hover:hover)]:hover:text-text",
        )}
      >
        <StableLabel>{label}</StableLabel>
        {count !== undefined && (
          <span
            aria-hidden
            className={cn("tnum font-medium", on ? "text-muted" : "text-placeholder")}
          >
            {fullNumber(count)}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

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

export function StateLabel({ tone, children }: { tone: StateTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm whitespace-nowrap", TONE[tone])}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="first-letter:uppercase">{children}</span>
    </span>
  );
}

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
      <OverflowTip content={titleHint}>
        <span className="truncate text-sm font-semibold">{title}</span>
      </OverflowTip>
      {sub && (
        <OverflowTip content={subHint}>
          <span className="truncate font-mono text-xs text-muted">{sub}</span>
        </OverflowTip>
      )}
    </span>
  );
}

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

/** TABLE goes on the <table>, HEAD on <thead>, ROW on each <tr>, one of MAIN / META / MENU on each cell. */
export const PHONE = {
  table: "max-sm:block max-sm:min-w-0",
  head: "max-sm:sr-only",
  body: "max-sm:block",
  row: "group/row max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3 max-sm:shadow-[inset_0_-1px_0_var(--border)]",
  main: "max-sm:order-0 max-sm:w-[calc(100%-3.5rem)] max-sm:border-0 max-sm:p-0",
  menu: "max-sm:order-1 max-sm:ml-auto max-sm:w-10 max-sm:border-0 max-sm:p-0",
  meta: "max-sm:order-2 max-sm:**:text-xs max-sm:inline-flex max-sm:items-baseline max-sm:gap-1 max-sm:border-0 max-sm:p-0 max-sm:text-left max-sm:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]",
  hide: "max-sm:hidden",
} as const;

export function SectionHeading({ children }: { children: string }) {
  return <h2 className="sr-only">{children}</h2>;
}
