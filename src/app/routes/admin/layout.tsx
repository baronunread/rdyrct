/**
 * The shell every platform-admin page sits in.
 *
 * The sidebar carries one "Platform" entry, not four. Four put "Links" in the
 * sidebar twice, once for the current organization's links and once for every
 * link on the instance, which is the kind of collision that makes somebody
 * click the wrong one during an incident. The five sections live here instead,
 * as tabs under one fixed title, where their labels are unambiguous because
 * everything around them is platform-wide. Switching tabs moves nothing above
 * them: the title, the subtitle and the tabs stay put, and only the section
 * below changes.
 */
import { Suspense, useRef } from "react";
import { TabUnderline } from "../../ui/tab-underline";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { AdminSectionSkeleton } from "../../components/skeletons";
import { useConfig } from "../../lib/hooks";
import { Segmented } from "../../ui/segmented";
import { useUsageRange, RANGE_ITEMS } from "./usage-range";

// The mock's order: who is on the instance before what they made.
const TABS = [
  { to: "/admin", end: true, label: "Usage" },
  { to: "/admin/users", end: false, label: "Users" },
  { to: "/admin/orgs", end: false, label: "Organizations" },
  { to: "/admin/links", end: false, label: "Links" },
  { to: "/admin/audit", end: false, label: "Audit log" },
] as const;

/** The usage range lives in the header, on the right of the title, so it
 * is in the same place whichever card is being read. Only on Usage. */
function RangeControl() {
  const [range, setRange] = useUsageRange();
  return <Segmented label="Range" items={RANGE_ITEMS} value={range} onChange={setRange} />;
}

export function AdminLayout() {
  const config = useConfig().data;
  const pathname = useLocation({ select: (l) => l.pathname });
  const onUsage = pathname === "/admin" || pathname === "/admin/";
  const bar = useRef<HTMLElement>(null);
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
      {/* Held still while one tab changes to another (styles.css, platform). */}
      <div data-platform-head className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-balance">Platform</h1>
            <p className="mt-1 text-sm text-pretty text-muted">
              Everything, across all organizations.
            </p>
          </div>
          {onUsage && <RangeControl />}
        </div>
        {/* Underline tabs, drawn as inset shadows so the hairline adds nothing
            to the box (rdyrct-design, "Depth from layered shadows"). */}
        <nav
          ref={bar}
          aria-label="Platform sections"
          className="relative -mx-1 flex gap-5 overflow-x-auto px-1 shadow-[inset_0_-1px_0_var(--border)]"
        >
          {TABS.map(({ to, end, label }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: end, includeSearch: false }}
              className="shrink-0 pb-2.5 text-sm whitespace-nowrap transition-colors"
              activeProps={{
                className: "font-semibold text-text",
                "aria-current": "page",
              }}
              inactiveProps={{ className: "text-muted [@media(hover:hover)]:hover:text-text" }}
            >
              {label}
            </Link>
          ))}
          <TabUnderline bar={bar} className="h-0.5" />
        </nav>
      </div>
      {/* Local to the section, not just the shell's outer one: without it, a
          tab whose chunk hasn't downloaded yet suspends past this nav too,
          so switching tabs used to blank the nav bar itself, not just the
          content below it. */}
      <Suspense fallback={<AdminSectionSkeleton />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
