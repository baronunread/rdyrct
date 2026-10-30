import {
  BuildingIcon,
  CardIcon,
  ChartIcon,
  GearIcon,
  GlobeIcon,
  GridIcon,
  KeyIcon,
  LinkIcon,
  UsersIcon,
} from "../ui/nav-icons";

/** The app's main nav, shared by AppShell and AppShellSkeleton so the
 * skeleton's inert copy can never drift from the real links. The icons are
 * Tabler at the mock's lighter stroke (ui/nav-icons.tsx). */
export const appNavItems = [
  { to: "/dashboard", icon: GridIcon, label: "Dashboard" },
  { to: "/analytics", icon: ChartIcon, label: "Analytics" },
  { to: "/links", icon: LinkIcon, label: "Links" },
  { to: "/domains", icon: GlobeIcon, label: "Domains" },
  { to: "/members", icon: UsersIcon, label: "Members" },
  { to: "/organization", icon: BuildingIcon, label: "Organization" },
  { to: "/api-keys", icon: KeyIcon, label: "API" },
  { to: "/billing", icon: CardIcon, label: "Billing" },
  { to: "/settings", icon: GearIcon, label: "Settings" },
] as const;
