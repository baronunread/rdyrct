import {
  CreditCard,
  Globe,
  LayoutDashboard,
  Link2,
  Settings,
  Users,
} from "lucide-react";

/** The app's main nav, shared by AppShell and AppShellSkeleton so the
 * skeleton's inert copy can never drift from the real links. */
export const appNavItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { to: "/links", icon: Link2, label: "Links" },
  { to: "/domains", icon: Globe, label: "Domains" },
  { to: "/members", icon: Users, label: "Members" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;
