import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import {
  ChevronsUpDown,
  Plus,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
} from "@/app/ui/icons";
import { MorphIcon } from "morphicons/react";
import { menu2, moon, sun, x } from "@/app/ui/icon-nodes";
import { useCurrentUser, useLogout, useShellUser } from "../lib/hooks";
import { useShellOrgs } from "../lib/current-org";
import { claimPendingLinks, storedAnonLinks } from "../lib/anon-links";
import { api, ApiError } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { Menu, MenuHeader, MenuItem, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";

import { AdminPlatformSkeleton, AppShellSkeleton, RouteSkeleton } from "../components/skeletons";
import { appNavItems } from "../components/nav-items";
import { OverLimitBanner } from "../components/over-limit";
import { UserAvatar } from "../components/user-avatar";
import { CommandMenu } from "../components/command-menu";
import { openCommandMenu } from "../lib/shortcut";
import { NewLinkHost } from "../components/new-link-host";
import { OrgMenuItems } from "../components/org-menu-items";
import { AppNotFound, InShell } from "../components/app-not-found";
import { WebMcpLinkTools } from "../components/webmcp-link-tools";
import { WebMcpAnalyticsTool } from "../components/webmcp-analytics-tool";
import { PLAN_LIMITS, type OrgPlan, type User, type UserOrg } from "@/shared/types";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { Logo, LogoMark } from "../ui/logo";
import { LayersIcon } from "../ui/nav-icons";
import { Tooltip, TooltipGroup } from "../ui/tooltip";
import { MOD_KEY, Shortcut } from "../ui/kbd";
import { cn } from "../ui/cn";
import {
  shellLayout,
  toggleSidebar,
  useSidebarCollapsed,
  useSidebarShortcut,
} from "../lib/sidebar";
import { useGoShortcuts } from "../lib/go-shortcuts";

const ORG_LIMIT_MESSAGE = "Upgrade to Pro to create more organizations";

/** Friendly message for a failed org-create request: the org-limit error
 * gets an upgrade nudge, everything else shows the server's own message. */
function orgCreateErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "org_limit") return ORG_LIMIT_MESSAGE;
  return errorMessage(cause);
}

const AUTH_PAGES = new Set(["/login", "/signup"]);

export function RequireAuth({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  const shell = useShellUser();
  const navigate = useNavigate();
  // Only the query says somebody is signed out, and only once it has spoken.
  const signedOut = !currentUser.isLoading && !currentUser.data;
  // An effect, not the declarative <Navigate>: <Navigate> re-invokes
  // navigate() on every render whose props object isn't the exact same
  // reference as last time (see its source), which JSX makes impossible to
  // guarantee, and reading useLocation() here to build the bounce-back
  // path fed the loop, since navigate() is what changes the location
  // useLocation() then reports. This effect only re-runs when `signedOut`
  // itself flips, and reads the current path imperatively instead.
  useEffect(() => {
    if (!signedOut) return;
    // The router can already be on the sign-in page while this is still
    // mounted (its chunk loads before the old route unmounts), and sending
    // that page back to itself as ?next= would be a loop in waiting.
    if (AUTH_PAGES.has(window.location.pathname)) return;
    const from = window.location.pathname + window.location.search;
    void navigate({ href: `/login?next=${encodeURIComponent(from)}`, replace: true });
  }, [signedOut, navigate]);
  if (signedOut) return null;
  // The cache carries the shell through the wait. A browser that has none is
  // on its first visit, and still gets the skeleton.
  if (!shell) return <AppShellSkeleton />;
  return children;
}

/** Platform admin surface: 404s (not a redirect) for non-admins, so the
 * admin area's existence isn't revealed to regular users. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  if (currentUser.isLoading) return <AdminPlatformSkeleton />;
  if (!currentUser.data?.user.isAdmin) return <AppNotFound />;
  return children;
}

// The current page is lifted onto the surface, like the sheet beside it, with
// its icon in the accent: one raised thing in the sidebar, not a tinted well.
const navLinkProps = {
  className:
    "flex h-9 min-w-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-[background-color,color] [&_svg]:shrink-0",
  activeProps: {
    className: "bg-surface font-medium text-text smooth-shadow-ring-xs [&_svg]:text-accent",
  },
  inactiveProps: {
    className:
      "text-muted [@media(hover:hover)]:hover:bg-surface/50 [@media(hover:hover)]:hover:text-text",
  },
};

/** The switcher's face: the org's initial, so a glance tells two orgs
 * apart, then its name. Folded, only the initial shows. */
function OrgTrigger({
  org,
  collapsed,
  phone,
}: {
  org: UserOrg | null;
  collapsed: boolean;
  phone?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-9 items-center gap-2.5 rounded-lg px-1.5 text-sm select-none",
        // In the drawer the switcher is lifted, as the mock draws it, so it
        // reads as a control and not as a heading over the nav.
        phone
          ? "h-11 rounded-[10px] bg-surface px-2 smooth-shadow-ring-xs"
          : "h-10 [@media(hover:hover)]:hover:bg-surface-2",
      )}
    >
      {org && (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-bg"
        >
          {org.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className={cn("min-w-0 flex-1 truncate font-semibold", fade(collapsed))}>
        {org ? org.name : "No organization"}
      </span>
      <ChevronsUpDown size={14} className={cn("shrink-0 text-muted", fade(collapsed))} />
    </div>
  );
}

function OrgSwitcherMenu({
  org,
  orgs,
  onSwitchOrg,
  canCreateOrg,
  onNewOrg,
  collapsed,
  phone,
}: {
  collapsed: boolean;
  phone?: boolean;
  org: UserOrg | null;
  orgs: UserOrg[];
  onSwitchOrg: (id: string) => void;
  canCreateOrg: boolean;
  onNewOrg: () => void;
}) {
  return (
    <Menu
      trigger={<OrgTrigger org={org} collapsed={collapsed} phone={phone} />}
      label="Switch organization"
    >
      <OrgMenuItems orgs={orgs} currentId={org?.id} onPick={onSwitchOrg} />
      <MenuSeparator />
      <MenuItem onClick={onNewOrg}>
        <span className="grid size-5 shrink-0 place-items-center text-muted">
          <Plus size={15} />
        </span>
        New organization
        {/* Only Pro holds more than one, so say so before the click. */}
        {!canCreateOrg && <span className="ml-auto text-xs text-muted">Pro</span>}
      </MenuItem>
    </Menu>
  );
}

/**
 * One entry, not four. The four sections are tabs inside /admin now: as
 * sidebar items they sat directly under the organization's own nav, where
 * "Links" appeared twice meaning two different things.
 */
function PlatformNav({
  visible,
  collapsed,
  phone,
}: {
  visible: boolean;
  collapsed: boolean;
  phone?: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="mt-2 px-3">
      <p className={cn("px-2.5 pb-1 text-xs font-medium text-muted", fade(collapsed))}>Admin</p>
      <nav className="flex flex-col gap-0.5">
        <NavItem
          to="/admin"
          icon={LayersIcon}
          label="Platform"
          collapsed={collapsed}
          phone={phone}
        />
      </nav>
    </div>
  );
}

/** Hidden in the rail but still laid out, so nothing beside it moves while
 * the sidebar folds: the rail only clips. */
const fade = (collapsed: boolean) =>
  cn("whitespace-nowrap transition-opacity duration-150", collapsed && "opacity-0");

function NavItem({
  to,
  icon: Icon,
  label,
  collapsed,
  phone,
}: {
  to: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  collapsed: boolean;
  /** The drawer's rows: 42px tall and 15px type, for a thumb. */
  phone?: boolean;
}) {
  const link = (
    <Link
      to={to}
      {...navLinkProps}
      className={cn(navLinkProps.className, phone && "h-[42px] gap-3 text-[15px]")}
    >
      <Icon size={phone ? 18 : 16} /> <span className={fade(collapsed)}>{label}</span>
    </Link>
  );
  // In the rail the icon is all that shows, so its name comes up beside it.
  return collapsed ? (
    <Tooltip grouped side="right" content={label}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** "[" as a key, for the fold tooltips. */
const foldKey = <Shortcut keys={["["]} tone="tooltip" />;

/**
 * The top of the sidebar, as ChatGPT has it. Open: the mark goes to the
 * dashboard, the convention people bring with them, and the fold button sits
 * on the right. Folded: the mark is all that is left, and pointing at it
 * turns it into the unfold button (the icon swap from the interfaces.dev
 * cheat sheet: scale, blur, fade).
 */
function SidebarTop({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="hidden h-14 items-center gap-1 px-3 md:flex">
      {collapsed ? (
        <Tooltip
          grouped
          side="right"
          content={<span className="flex items-center gap-2">Expand sidebar {foldKey}</span>}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            className="group/mark relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg [@media(hover:hover)]:hover:bg-surface-2"
          >
            <LogoMark className="h-[18px] transition-[opacity,scale,filter] duration-200 ease-out group-hover/mark:scale-25 group-hover/mark:opacity-0 group-hover/mark:blur-[4px] group-focus-visible/mark:scale-25 group-focus-visible/mark:opacity-0" />
            <PanelLeftOpen
              size={18}
              className="absolute scale-25 text-muted opacity-0 blur-[4px] transition-[opacity,scale,filter] duration-200 ease-out group-hover/mark:scale-100 group-hover/mark:opacity-100 group-hover/mark:blur-none group-focus-visible/mark:scale-100 group-focus-visible/mark:opacity-100 group-focus-visible/mark:blur-none"
            />
          </button>
        </Tooltip>
      ) : (
        <Link
          to="/dashboard"
          aria-label="rdyrct, dashboard"
          className="grid size-9 shrink-0 place-items-center rounded-lg"
        >
          <LogoMark className="h-[18px]" />
        </Link>
      )}
      <div inert={collapsed} className={cn("ml-auto", fade(collapsed))}>
        <Tooltip
          grouped
          side="right"
          content={<span className="flex items-center gap-2">Collapse sidebar {foldKey}</span>}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted transition-[background-color,color,scale] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
          >
            <PanelLeftClose size={16} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Who is signed in, and what they can do about it. The header names the
 * account (name over email, for anybody with two); search sits here too so a
 * phone, which has no ⌘K, still lists it. */
function AccountMenu({
  user,
  theme,
  onToggleTheme,
  onSignOut,
  signOutPending,
  trigger,
}: {
  user: User;
  theme: ReturnType<typeof useTheme>[0];
  onToggleTheme: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
  trigger: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Menu label="Account menu" trigger={trigger}>
      <MenuHeader title={user.name} detail={user.email} />
      <MenuSeparator />
      <MenuItem onClick={() => void navigate({ to: "/settings" })}>
        <Settings size={15} className="text-muted" /> Settings
      </MenuItem>
      <MenuItem closeOnClick={false} onClick={onToggleTheme}>
        <MorphIcon
          icon={theme === "dark" ? sun : moon}
          size={15}
          spring="snappy"
          className="text-muted"
        />
        {theme === "dark" ? "Light theme" : "Dark theme"}
      </MenuItem>
      <MenuItem onClick={openCommandMenu}>
        <Search size={15} className="text-muted" /> Search and commands
        <Shortcut keys={[MOD_KEY, "K"]} className="ml-auto gap-0.5 max-md:hidden" />
      </MenuItem>
      <MenuSeparator />
      <MenuItem className="text-danger" disabled={signOutPending} onClick={onSignOut}>
        <LogOut size={15} /> Sign out
      </MenuItem>
    </Menu>
  );
}

function AppSidebar({
  org,
  orgs,
  onSwitchOrg,
  canCreateOrg,
  onNewOrg,
  user,
  theme,
  onToggleTheme,
  onSignOut,
  signOutPending,
  collapsed = false,
  phone = false,
}: {
  /** Folded to the icon rail. Desktop only: the phone drawer is always open. */
  collapsed?: boolean;
  /** Drawn in the phone drawer: the logo on top, bigger rows, and the
   * account row with its email and no ⌘K, since a phone has no keyboard. */
  phone?: boolean;
  org: UserOrg | null;
  orgs: UserOrg[];
  onSwitchOrg: (id: string) => void;
  canCreateOrg: boolean;
  onNewOrg: () => void;
  user: User;
  theme: ReturnType<typeof useTheme>[0];
  onToggleTheme: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
}) {
  const account = { user, theme, onToggleTheme, onSignOut, signOutPending };
  return (
    <TooltipGroup>
      <div className={cn("flex h-full flex-col overflow-hidden", phone && "overflow-y-auto")}>
        {phone ? (
          <div className="flex h-12 shrink-0 items-center px-5 pt-1">
            <Link to="/dashboard" aria-label="rdyrct, dashboard" className="text-base">
              <Logo />
            </Link>
          </div>
        ) : (
          <SidebarTop collapsed={collapsed} />
        )}

        {/* org switcher */}
        <div className="px-3 py-2">
          <OrgSwitcherMenu
            org={org}
            orgs={orgs}
            onSwitchOrg={onSwitchOrg}
            canCreateOrg={canCreateOrg}
            onNewOrg={onNewOrg}
            collapsed={collapsed}
            phone={phone}
          />
        </div>

        {/* nav — always visible: org-scoped pages render their own empty state
          when no org exists yet, and billing is per-user */}
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          {appNavItems
            .filter(({ to }) => to !== "/billing" || user.plan !== "unlimited")
            .map(({ to, icon, label }) => (
              <NavItem
                key={to}
                to={to}
                icon={icon}
                label={label}
                collapsed={collapsed}
                phone={phone}
              />
            ))}
        </nav>

        <PlatformNav visible={user.isAdmin} collapsed={collapsed} phone={phone} />

        {phone ? (
          <div className="mt-auto px-3 py-3">
            <AccountMenu
              {...account}
              trigger={
                <div className="flex min-h-12 items-center gap-2.5 rounded-[10px] px-2 py-1.5 [@media(hover:hover)]:hover:bg-surface/50">
                  <UserAvatar user={user} size={28} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold">{user.name}</span>
                    <span className="truncate text-xs text-muted">{user.email}</span>
                  </span>
                  <ChevronsUpDown size={14} className="shrink-0 text-muted" />
                </div>
              }
            />
          </div>
        ) : (
          /* You: avatar, name, and the ⌘K key, which opens search (its one
            home now the top row only folds). The email heads the menu. */
          <div className="mt-auto flex items-center gap-0.5 px-3 py-3">
            <div className="min-w-0 flex-1">
              <AccountMenu
                {...account}
                trigger={
                  <div className="flex min-w-9 items-center gap-2.5 rounded-lg px-1 py-1.5 [@media(hover:hover)]:hover:bg-surface/50">
                    <UserAvatar user={user} size={28} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm font-semibold",
                        fade(collapsed),
                      )}
                    >
                      {user.name}
                    </span>
                  </div>
                }
              />
            </div>
            <button
              type="button"
              inert={collapsed}
              onClick={openCommandMenu}
              aria-label="Search and commands"
              title="Search and commands"
              className={cn(
                "shrink-0 cursor-pointer rounded-md p-0.5 transition-[scale,opacity] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:[&_kbd]:text-text",
                fade(collapsed),
              )}
            >
              <Shortcut keys={[MOD_KEY, "K"]} className="gap-0.5" />
            </button>
          </div>
        )}
      </div>
    </TooltipGroup>
  );
}

/**
 * The phone's sidebar: a full-height sheet floating over the dimmed page,
 * the logo at its top, as the mock draws it. It sits above the top bar, so
 * the dimmed strip to its right (and Escape) is how it closes.
 */
function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A menu open inside the drawer takes its own Escape first.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-40 md:hidden">
              {/* A dimmed page behind the drawer says it is on top and that a
                  tap outside closes it. A real button, so it is reachable. */}
              <m.button
                type="button"
                aria-label="Close menu"
                className="absolute inset-0 cursor-default bg-[rgb(23_21_31/0.32)] dark:bg-black/50"
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
              <m.div
                className="absolute top-1.5 bottom-1.5 left-1.5 w-[min(300px,calc(100vw-3.5rem))] overflow-hidden rounded-[26px] bg-bg pt-2 smooth-shadow-ring-xl"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12, filter: "blur(4px)", transition: { duration: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                {children}
              </m.div>
            </div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}

const PLAN_NAME = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "this instance",
} satisfies Record<OrgPlan, string>;

/** "You own 1 of 3 organizations on Pro." Nothing to count on a self-hosted
 * copy, where the cap is a number nobody reaches. */
function ownedLine(owned: number, plan: OrgPlan): string | null {
  if (plan === "unlimited") return null;
  const limit = PLAN_LIMITS[plan].orgs;
  return `You own ${owned} of ${limit} ${limit === 1 ? "organization" : "organizations"} on ${PLAN_NAME[plan]}.`;
}

function NewOrgDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onCreate,
  pending,
  owned,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  pending: boolean;
  owned: number;
  plan: OrgPlan;
}) {
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const line = ownedLine(owned, plan);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Submit stays enabled; an empty name marks the field and says why.
    if (!name.trim()) {
      setError("Required");
      input.current?.focus();
      return;
    }
    onCreate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(undefined);
        onOpenChange(next);
      }}
      title="New organization"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label="Name"
          error={error}
          hint="Its own links, domains and members. Your plan covers it."
        >
          <Input
            ref={input}
            value={name}
            onChange={(e) => {
              onNameChange(e.target.value);
              if (error) setError(undefined);
            }}
            placeholder="Orbit Studio"
            autoComplete="organization"
            autoFocus
            className="h-10"
          />
        </Field>
        {line && <p className="text-xs text-muted tabular-nums">{line}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            <BusyContent busy={pending}>Create organization</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Hands over the links somebody made on the landing page before they had an
 * account (#96), as soon as there is an organization to hand them to.
 *
 * It used to happen inside "create your organization", which meant three
 * links sat in localStorage waiting on a form. Every account now owns an
 * organization from its first session, so the claim belongs here: they are
 * kept the moment the app loads, and the person is told how many landed
 * rather than left to count rows.
 *
 * Once per mount, and silent when there is nothing to claim, which is the
 * common case.
 */
function useClaimAnonLinks(orgId: string | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const claimed = useRef(false);

  useEffect(() => {
    if (!orgId || claimed.current || storedAnonLinks().length === 0) return;
    claimed.current = true;
    void (async () => {
      const kept = await claimPendingLinks(orgId);
      // Zero means every claim was refused: expired, or already taken. The
      // links are gone either way and saying so helps nobody.
      if (kept === 0) return;
      await qc.invalidateQueries({ queryKey: ["links", orgId] });
      await qc.invalidateQueries({ queryKey: ["stats", orgId] });
      // The claim just added links, and billing's first-link hand-off asks
      // whether the count is still zero.
      await qc.invalidateQueries({ queryKey: ["linkQuotaUsage", orgId] });
      // The one moment in the app worth sounding pleased about: they made
      // something before they had an account, and it survived. A sentence
      // that reads like a receipt wastes it.
      toast("Welcome. Your link is already here.");
    })();
  }, [orgId, qc, toast]);
}

/**
 * The signed-in app: sidebar, phone top bar and drawer, ⌘K, and the sheet
 * the page sits on. `children` stands in for the route's outlet, for the
 * in-app 404, which the router renders outside any app route.
 */
export function AppShell({ children }: { children?: ReactNode }) {
  const shell = useShellUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useLogout();
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useSidebarCollapsed();
  const layout = shellLayout(collapsed);
  useSidebarShortcut();
  useGoShortcuts();

  // A tap on a row in the drawer goes somewhere, and the drawer has done
  // its job: close it with the page change rather than leave it over the
  // page that just loaded.
  const pathname = useLocation({ select: (l) => l.pathname });
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  const { org, orgs, setOrg } = useShellOrgs();
  useClaimAnonLinks(org?.id);

  if (!shell) return null;
  // No org is fine: org-scoped pages render NoOrgState, billing is per-user.
  const { user } = shell;

  // Multi-org is a Pro perk: the owned-org cap comes from the caller's plan.
  const ownedCount = orgs.filter((o) => o.role === "owner").length;
  const canCreateOrg = ownedCount < PLAN_LIMITS[user.plan].orgs;

  const switchOrg = (id: string) => {
    setOrg(id);
    // A link detail page's slug may not exist under the new org; every other
    // route (including platform admin) has nothing org-specific in its URL,
    // so switching org there should leave the user right where they are.
    if (window.location.pathname.startsWith("/links/")) navigate({ to: "/dashboard" });
  };

  const createOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setCreatingOrg(true);
    try {
      const created = await api<{ id: string }>("/orgs", {
        method: "POST",
        body: { name },
      });
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("organization_created");
      posthog.capture(FUNNEL.orgCreated, { from: "switcher" });
      setNewOrgOpen(false);
      setNewOrgName("");
      // Same claim as the empty state: someone can sign up, skip the
      // first prompt, and create their org from the switcher instead.
      await claimPendingLinks(created.id);
      setOrg(created.id);
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast(orgCreateErrorMessage(e), "error");
    } finally {
      setCreatingOrg(false);
    }
  };

  const onNewOrg = () => (canCreateOrg ? setNewOrgOpen(true) : toast(ORG_LIMIT_MESSAGE, "error"));
  const onSignOut = () =>
    logout.mutate(undefined, {
      // Explicit, not left to RequireAuth's own redirect: that one appends
      // ?next=<wherever you were>, right for landing on a stale link, wrong
      // for a deliberate sign-out.
      onSuccess: () => navigate({ to: "/login" }),
      onError: (error) => toast(error.message, "error"),
    });

  const closeDrawer = () => setMobileOpen(false);
  const sidebarProps = {
    org,
    orgs,
    onSwitchOrg: switchOrg,
    canCreateOrg,
    onNewOrg,
    user,
    theme,
    onToggleTheme: toggleTheme,
    onSignOut,
    signOutPending: logout.isPending,
  };

  return (
    <NewLinkHost>
      <div className="flex min-h-dvh">
        <CommandMenu />
        <WebMcpLinkTools />
        <WebMcpAnalyticsTool />
        {/* desktop sidebar: fixed so it never moves, not even on overscroll */}
        <aside className={layout.aside}>
          <AppSidebar {...sidebarProps} collapsed={collapsed} />
        </aside>

        {/* mobile top bar + drawer */}
        <div className="fixed inset-x-0 top-0 z-30 flex h-[52px] items-center gap-1.5 bg-bg/90 px-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
            className="grid size-10 cursor-pointer place-items-center rounded-lg text-text transition-[scale] duration-200 ease-out active:scale-[0.96]"
          >
            <MorphIcon icon={mobileOpen ? x : menu2} size={20} spring="snappy" />
          </button>
          <Link to="/dashboard" aria-label="rdyrct, dashboard" className="text-base">
            <Logo />
          </Link>
          {/* A phone has no ⌘K, so search gets a button of its own. */}
          <button
            type="button"
            onClick={openCommandMenu}
            aria-label="Search and commands"
            className="ml-auto grid size-10 cursor-pointer place-items-center rounded-lg text-muted transition-[scale] duration-200 ease-out active:scale-[0.96]"
          >
            <Search size={20} />
          </button>
        </div>
        <MobileDrawer open={mobileOpen} onClose={closeDrawer}>
          <AppSidebar {...sidebarProps} phone />
        </MobileDrawer>

        {/* One raised sheet for the page; the sidebar and the phone bar sit on
          the paper behind it (rdyrct-design, "The app's surfaces"). */}
        <main className={layout.main}>
          <div data-app-sheet className={layout.scroller}>
            <div className="mx-auto w-full max-w-5xl flex-1">
              {/* Above the route, not inside each one: the state belongs to the
              org, so it says the same thing on every page (#163). */}
              <OverLimitBanner />
              {/* pages are lazy chunks: keep the shell in place while one loads,
              behind the shape that chunk is about to render */}
              <Suspense fallback={<RouteSkeleton />}>
                <InShell.Provider value>{children ?? <Outlet />}</InShell.Provider>
              </Suspense>
            </div>
          </div>
        </main>

        <NewOrgDialog
          open={newOrgOpen}
          onOpenChange={setNewOrgOpen}
          name={newOrgName}
          onNameChange={setNewOrgName}
          onCreate={createOrg}
          pending={creatingOrg}
          owned={ownedCount}
          plan={user.plan}
        />
      </div>
    </NewLinkHost>
  );
}
