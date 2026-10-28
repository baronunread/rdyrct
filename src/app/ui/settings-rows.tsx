import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Settings as rows, not cards with footers (rdyrct-design, "The app's
 * surfaces"): what it is on the left, the control on the right, one card per
 * group under a small muted heading. On a phone the control drops under its
 * label.
 */
export function SettingsGroup({
  title,
  hint,
  badge,
  action,
  danger,
  children,
}: {
  title?: string;
  /** One line beside the heading, for the whole group. */
  hint?: string;
  /** Beside the heading: the "Paid" badge on a group the plan lacks. */
  badge?: ReactNode;
  /** One quiet link at the right end of the heading row. */
  action?: ReactNode;
  /** Outlined in the danger colour: for "Delete organization" and the like. */
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {title && <GroupHeading title={title} hint={hint} badge={badge} action={action} />}
      <div
        className={cn(
          "rounded-xl bg-surface [&>*+*]:shadow-[inset_0_1px_0_var(--border)]",
          danger
            ? "shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]"
            : "smooth-shadow-ring-xs",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function GroupHeading({
  title,
  hint,
  badge,
  action,
}: {
  title: string;
  hint?: string;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  // With an action, a phone keeps it on the title's line and drops the
  // hint below both.
  const hintClass = cn("text-xs text-muted", action && "max-sm:order-last max-sm:basis-full");
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {badge}
      {hint && <p className={hintClass}>{hint}</p>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  /** At most one short line. A paragraph here means the setting needs a
   *  better name, not more words. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
      <div className="min-w-0 sm:w-64">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-pretty text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 max-sm:w-full max-sm:justify-start">
        {children}
      </div>
    </div>
  );
}
