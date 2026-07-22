import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { Link } from "react-router";
import { cn } from "./cn";
import { Footer } from "./footer";

const badgeColors = {
  muted: "border-border text-muted",
  accent: "border-accent/40 text-accent",
  mint: "border-accent-2/40 text-accent-2",
  pink: "border-pink/40 text-pink",
  butter: "border-butter/40 text-butter",
};

export function Badge({
  color = "muted",
  children,
}: {
  color?: "muted" | "accent" | "mint" | "pink" | "butter";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs tracking-wide",
        badgeColors[color],
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      {children}
    </div>
  );
}

export function Table({ children, fixed }: { children: ReactNode; fixed?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table
        className={`w-full text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-2/40 ${fixed ? "table-fixed" : ""}`}
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
