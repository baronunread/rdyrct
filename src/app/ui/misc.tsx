import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { Link } from "react-router";
import { cn } from "./cn";
import { Footer } from "./footer";
import { Tooltip } from "./tooltip";

const badgeColors = {
  muted: "border-border text-muted",
  accent: "border-accent/40 text-accent",
  mint: "border-accent-2/40 text-accent-2",
  pink: "border-pink/40 text-pink",
  butter: "border-butter/40 text-butter",
};

export function Badge({
  color = "muted",
  className,
  children,
}: {
  color?: "muted" | "accent" | "mint" | "pink" | "butter";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs tracking-wide",
        badgeColors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A link's slug ("/name"), truncated with an ellipsis instead of wrapping
 * or overflowing its row when it's long. `min-w-0` (shrink below content in
 * a flex row) and `max-w-full` (cap width in a flex column, where
 * `align-items: flex-start` sizes to content otherwise) cover both layouts
 * `truncate` shows up in around the app. The full slug still shows on hover
 * via a tooltip. */
export function Slug({ slug, className }: { slug: string; className?: string }) {
  return (
    <Tooltip content={`/${slug}`}>
      <span className={cn("min-w-0 max-w-full truncate", className)}>/{slug}</span>
    </Tooltip>
  );
}

/** A row linking to a link's detail page by slug, with an optional title
 * suffix: the shape repeated across the dashboard's and analytics' link
 * lists (top links, decaying, dead). Truncates instead of wrapping or
 * overflowing; the full text still shows on hover via `title`. */
export function SlugLink({
  to,
  slug,
  title,
  className,
}: {
  to: string;
  slug: string;
  title?: string;
  className?: string;
}) {
  const text = title ? `/${slug} · ${title}` : `/${slug}`;
  return (
    <Link
      to={to}
      title={text}
      className={cn("min-w-0 max-w-full truncate text-accent hover:underline", className)}
    >
      {text}
    </Link>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg bg-surface p-4 smooth-shadow-ring-xs", className)}>
      {children}
    </div>
  );
}

export function Table({
  children,
  fixed,
  minWidth,
}: {
  children: ReactNode;
  fixed?: boolean;
  /** Tailwind min-width for the table itself, e.g. "min-w-[64rem]". Use it
   * when every column has to stay on screen and the wrapper should scroll
   * rather than the columns shrinking into uselessness. */
  minWidth?: string;
}) {
  return (
    // overscroll-x-none, not -contain. `contain` only stops the scroll
    // chaining to the page; the container still rubber-bands at each end,
    // and that bounce drags the table off its own background so the page
    // shows through beside it. `none` disables the bounce as well.
    <div className="overflow-x-auto overscroll-x-none rounded-lg bg-surface smooth-shadow-ring-xs">
      <table
        className={cn(
          "w-full text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-2/40",
          fixed && "table-fixed",
          minWidth,
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-border px-4 py-2.5 text-left text-2xs font-normal tracking-wider text-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border/50 px-4 py-2.5", className)} {...props} />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-14 text-center">
      <p className="font-bold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold tracking-wide">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function LegalPageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link to="/" className="text-lg font-bold tracking-widest">
          rdyrct
        </Link>
      </header>
      <div className="flex flex-col gap-8 text-sm">{children}</div>
      <Footer />
    </div>
  );
}
