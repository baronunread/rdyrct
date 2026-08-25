import {
  ChartColumn,
  CreditCard,
  LayoutDashboard,
  Link2,
  Settings,
  Users,
  WorldWww,
} from "@/app/ui/icons";

/** The app's main nav, shared by AppShell and AppShellSkeleton so the
 * skeleton's inert copy can never drift from the real links. */
export const appNavItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/analytics", icon: ChartColumn, label: "Analytics" },
  { to: "/links", icon: Link2, label: "Links" },
  { to: "/domains", icon: WorldWww, label: "Domains" },
  { to: "/members", icon: Users, label: "Members" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;
