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
import { Link, Outlet } from "@tanstack/react-router";
import { Activity, Building2, Link2, ScrollText, UserCog } from "@/app/ui/icons";

const TABS = [
  { to: "/admin", end: true, icon: Activity, label: "Usage" },
  { to: "/admin/links", end: false, icon: Link2, label: "Links" },
  { to: "/admin/orgs", end: false, icon: Building2, label: "Organizations" },
  { to: "/admin/users", end: false, icon: UserCog, label: "Users" },
  { to: "/admin/audit", end: false, icon: ScrollText, label: "Audit log" },
] as const;

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label="Platform sections"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px"
      >
        {TABS.map(({ to, end, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: end }}
            className="flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors"
            activeProps={{ className: "border-accent text-text" }}
            inactiveProps={{ className: "border-transparent text-muted hover:text-text" }}
          >
            <Icon size={15} /> {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
