/**
 * The shell every platform-admin page sits in.
 *
 * The sidebar carries one "Platform" entry, not four. Four put "Links" in the
 * sidebar twice, once for the current organization's links and once for every
 * link on the instance, which is the kind of collision that makes somebody
 * click the wrong one during an incident. The four sections live here instead,
 * as tabs, where their labels are unambiguous because everything around them
 * is platform-wide.
 */
import { Suspense } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { RouteSkeleton } from "../../components/skeletons";
import { useConfig } from "../../lib/hooks";

// The mock's order: who is on the instance before what they made.
const TABS = [
  { to: "/admin", end: true, label: "Usage" },
  { to: "/admin/users", end: false, label: "Users" },
  { to: "/admin/orgs", end: false, label: "Organizations" },
  { to: "/admin/links", end: false, label: "Links" },
  { to: "/admin/audit", end: false, label: "Audit log" },
] as const;

export function AdminLayout() {
  const config = useConfig().data;
  // No email and no Google: nobody proves they own the address they sign up
  // with. Fine on a private instance, wrong on a public one.
  const unverified = config && !config.emailEnabled && !config.googleEnabled;
  return (
    <div className="flex flex-col gap-5">
      {unverified && (
        <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
          This instance has no email provider and no Google sign-in, so accounts are not verified
          and passwords cannot be reset. Do not run it open to the public. Set RESEND_API_KEY to
          turn verification on.
        </p>
      )}
      {/* Underline tabs, drawn as inset shadows so the hairline adds nothing
          to the box (rdyrct-design, "Depth from layered shadows"). */}
      <nav
        aria-label="Platform sections"
        className="flex gap-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]"
      >
        {TABS.map(({ to, end, label }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: end }}
            className="pb-2.5 text-sm whitespace-nowrap transition-colors"
            activeProps={{
              className: "font-semibold text-text shadow-[inset_0_-2px_0_var(--text)]",
            }}
            inactiveProps={{ className: "text-muted [@media(hover:hover)]:hover:text-text" }}
          >
            {label}
          </Link>
        ))}
      </nav>
      {/* Local to the section, not just the shell's outer one: without it, a
          tab whose chunk hasn't downloaded yet suspends past this nav too,
          so switching tabs used to blank the nav bar itself, not just the
          content below it. */}
      <Suspense fallback={<RouteSkeleton />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
