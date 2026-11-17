/** One "Platform" sidebar entry, not four: four put "Links" in the sidebar twice (org links and every link), which invites a wrong click in an incident. */
import { Suspense, useRef } from "react";
import { TabUnderline } from "../../ui/tab-underline";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { AdminSectionSkeleton } from "../../components/skeletons";
import { useConfig } from "../../lib/hooks";
import { Segmented } from "../../ui/segmented";
import { useUsageRange, RANGE_ITEMS } from "./usage-range";
import { StableLabel } from "../../ui/stable-label";

const TABS = [
  { to: "/admin", end: true, label: "Usage" },
  { to: "/admin/users", end: false, label: "Users" },
  { to: "/admin/orgs", end: false, label: "Organizations" },
  { to: "/admin/links", end: false, label: "Links" },
  { to: "/admin/audit", end: false, label: "Audit log" },
  { to: "/admin/newsletter", end: false, label: "Newsletter" },
] as const;

function RangeControl() {
  const [range, setRange] = useUsageRange();
  return <Segmented label="Range" items={RANGE_ITEMS} value={range} onChange={setRange} />;
}

export function AdminLayout() {
  const config = useConfig().data;
  const pathname = useLocation({ select: (l) => l.pathname });
  const onUsage = pathname === "/admin" || pathname === "/admin/";
  const bar = useRef<HTMLElement>(null);
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
        <nav
          ref={bar}
          aria-label="Platform sections"
          className="relative flex gap-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]"
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
              <StableLabel>{label}</StableLabel>
            </Link>
          ))}
          <TabUnderline bar={bar} className="h-0.5" />
        </nav>
      </div>
      {/* Local to the section: without it a tab whose chunk has not downloaded suspends past this nav too and blanks it. */}
      <Suspense fallback={<AdminSectionSkeleton />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
