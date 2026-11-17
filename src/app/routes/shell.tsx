import {
  Suspense,
  useEffect,
  useEffectEvent,
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
import { takeDeliberateSignOut, useCurrentUser, useLogout, useShellUser } from "../lib/hooks";
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
import { SetupChecklist, SetupGuideItem } from "../components/setup-checklist";
import { UserAvatar } from "../components/user-avatar";
import { CommandMenu } from "../components/command-menu";
import { MarketingPrompt } from "../components/marketing-prompt";
import { openCommandMenu } from "../lib/shortcut";
import { NewLinkHost } from "../components/new-link-host";
import { OrgMenuItems } from "../components/org-menu-items";
import { AppNotFound } from "../components/app-not-found";
import { Unreachable } from "../components/unreachable";
import { InShell } from "../lib/in-shell";
import { WebMcpLinkTools } from "../components/webmcp-link-tools";
import { WebMcpAnalyticsTool } from "../components/webmcp-analytics-tool";
import { type AccountTier, type User, type UserOrg } from "@/shared/types";
import { ORG_LIMIT_MESSAGE } from "@/shared/support";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { Logo, LogoMark } from "../ui/logo";
import { LayersIcon } from "../ui/nav-icons";
import { Tooltip, TooltipGroup } from "../ui/tooltip";
import { Shortcut } from "../ui/kbd";
import { MOD_KEY } from "../lib/shortcut";
import { cn } from "../ui/cn";
import {
  shellLayout,
  toggleSidebar,
  useSidebarCollapsed,
  useSidebarShortcut,
} from "../lib/sidebar";
import { useGoShortcuts } from "../lib/go-shortcuts";

function orgCreateErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "org_limit") return ORG_LIMIT_MESSAGE;
  return errorMessage(cause);
}

const AUTH_PAGES = new Set(["/login", "/signup"]);

export function RequireAuth({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  const shell = useShellUser();
  const navigate = useNavigate();
  // Only a 401 means signed out. A 5xx or dropped connection is an error and must not send a signed-in person to login (#487).
  const signedOut = currentUser.data === null;
  const unreachable = currentUser.isError && currentUser.data === undefined;
  // An effect, not <Navigate>: it re-invokes navigate() on every render with a new props object, which looped.
  useEffect(() => {
    if (!signedOut) return;
    // The router can still be on the sign-in page while this is mounted; ?next= pointing at itself would loop.
    const deliberate = takeDeliberateSignOut();
    if (AUTH_PAGES.has(window.location.pathname)) return;
    const from = window.location.pathname + window.location.search;
    const href = deliberate ? "/login" : `/login?next=${encodeURIComponent(from)}`;
    void navigate({ href, replace: true });
  }, [signedOut, navigate]);
  if (signedOut) return null;
  if (unreachable)
    return (
      <Unreachable onRetry={() => void currentUser.refetch()} retrying={currentUser.isFetching} />
    );
  if (!shell) return <AppShellSkeleton />;
  return children;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  if (currentUser.data === undefined) return currentUser.isError ? null : <AdminPlatformSkeleton />;
  if (!currentUser.data?.user.isAdmin) return <AppNotFound />;
  return children;
}

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

function triggerClass(phone?: boolean, still?: boolean): string {
  return cn(
    "flex w-full min-w-9 items-center gap-2.5 rounded-lg px-1.5 text-sm select-none",
    phone
      ? "h-11 rounded-[10px] bg-surface px-2 smooth-shadow-ring-xs"
      : cn("h-10", !still && "[@media(hover:hover)]:hover:bg-surface-2"),
  );
}

function OrgTrigger({
  org,
  collapsed,
  phone,
  still,
}: {
  org: UserOrg | null;
  collapsed: boolean;
  phone?: boolean;
  still?: boolean;
}) {
  return (
    <div
      // Tests find the organization's name here, menu or not.
      data-org-switcher=""
      data-setup-card={phone ? undefined : ""}
      className={triggerClass(phone, still)}
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
      {!still && (
        <ChevronsUpDown size={14} className={cn("shrink-0 text-muted", fade(collapsed))} />
      )}
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
  if (orgs.length <= 1 && !canCreateOrg)
    return <OrgTrigger org={org} collapsed={collapsed} phone={phone} still />;
  return (
    <Menu
      trigger={<OrgTrigger org={org} collapsed={collapsed} phone={phone} />}
      label="Switch organization"
    >
      <OrgMenuItems orgs={orgs} currentId={org?.id} onPick={onSwitchOrg} />
      {canCreateOrg && (
        <>
          <MenuSeparator />
          <MenuItem onClick={onNewOrg}>
            <span className="grid size-5 shrink-0 place-items-center text-muted">
              <Plus size={15} />
            </span>
            New organization
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

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
  return collapsed ? (
    <Tooltip grouped side="right" content={label}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

const foldKey = <Shortcut keys={["["]} tone="tooltip" />;

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
            data-setup-logo
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
          data-setup-logo
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

function AccountMenu({
  user,
  theme,
  onToggleTheme,
  onSignOut,
  signOutPending,
  trigger,
  extra,
}: {
  extra?: ReactNode;
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
      {extra}
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
  collapsed?: boolean;
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
  const account = {
    user,
    theme,
    onToggleTheme,
    onSignOut,
    signOutPending,
    extra: <SetupGuideItem org={org} />,
  };
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

        <nav data-setup-nav={phone ? undefined : ""} className="flex flex-col gap-0.5 px-3 py-2">
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

        <div className="mt-auto">
          {/* Laid out at the open width and faded, not removed: unmounting squeezed the words into the rail and wrapped them. */}
          <div
            inert={collapsed}
            className={cn(
              "transition-opacity duration-150",
              !phone && "w-60 shrink-0",
              collapsed && "opacity-0",
            )}
          >
            <SetupChecklist org={org} phone={phone} />
          </div>
          {phone ? (
            <div className="px-3 py-3">
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
            <div className="flex items-center gap-0.5 px-3 py-3">
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
              <Tooltip grouped content="Search and commands">
                <button
                  type="button"
                  inert={collapsed}
                  onClick={openCommandMenu}
                  aria-label="Search and commands"
                  className={cn(
                    "shrink-0 cursor-pointer rounded-md p-0.5 transition-[scale,opacity] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:[&_kbd]:text-text",
                    fade(collapsed),
                  )}
                >
                  <Shortcut keys={[MOD_KEY, "K"]} className="gap-0.5" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </TooltipGroup>
  );
}

function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) onClose();
  });
  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {open && (
            <div data-app-drawer className="fixed inset-0 z-40 md:hidden">
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

const TIER_NAME = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  enterprise: "Enterprise",
  unlimited: "this instance",
} satisfies Record<AccountTier, string>;

function ownedLine(owned: number, limit: number, tier: AccountTier): string | null {
  if (tier === "unlimited") return null;
  return `You own ${owned} of ${limit} ${limit === 1 ? "organization" : "organizations"} on ${TIER_NAME[tier]}.`;
}

function NewOrgDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onCreate,
  pending,
  owned,
  limit,
  tier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  pending: boolean;
  owned: number;
  limit: number;
  tier: AccountTier;
}) {
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const line = ownedLine(owned, limit, tier);
  const submit = (e: FormEvent) => {
    e.preventDefault();
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

/** Once per mount; silent when there is nothing to claim (#96). */
function useClaimAnonLinks(orgId: string | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const claimed = useRef(false);

  useEffect(() => {
    if (!orgId || claimed.current || storedAnonLinks().length === 0) return;
    claimed.current = true;
    void (async () => {
      const kept = await claimPendingLinks(orgId);
      if (kept === 0) return;
      await qc.invalidateQueries({ queryKey: ["links", orgId] });
      await qc.invalidateQueries({ queryKey: ["stats", orgId] });
      await qc.invalidateQueries({ queryKey: ["linkQuotaUsage", orgId] });
      toast("Your link is saved to your account.");
    })();
  }, [orgId, qc, toast]);
}

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

  const pathname = useLocation({ select: (l) => l.pathname });
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  const { org, orgs, setOrg } = useShellOrgs();
  useClaimAnonLinks(org?.id);

  if (!shell) return null;
  const { user } = shell;

  const ownedCount = orgs.filter((o) => o.role === "owner").length;
  const canCreateOrg = ownedCount < user.limits.orgs;

  const switchOrg = (id: string) => {
    setOrg(id);
    // A link detail page's slug may not exist under the new org; other routes stay where they are.
    if (window.location.pathname.startsWith("/links/")) void navigate({ to: "/dashboard" });
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
      await claimPendingLinks(created.id);
      setOrg(created.id);
      void navigate({ to: "/dashboard" });
    } catch (e) {
      toast(orgCreateErrorMessage(e), "error");
    } finally {
      setCreatingOrg(false);
    }
  };

  const onNewOrg = () => (canCreateOrg ? setNewOrgOpen(true) : toast(ORG_LIMIT_MESSAGE, "error"));
  const onSignOut = () =>
    logout.mutate(undefined, {
      // Explicit: RequireAuth's redirect appends ?next=, which is wrong for a deliberate sign-out.
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
        <MarketingPrompt />
        <WebMcpLinkTools />
        <WebMcpAnalyticsTool />
        <aside className={layout.aside}>
          <AppSidebar {...sidebarProps} collapsed={collapsed} />
        </aside>

        <div
          data-app-bar
          className="fixed inset-x-0 top-0 z-30 flex h-[52px] items-center gap-1.5 bg-bg/90 px-3 backdrop-blur md:hidden"
        >
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

        <main className={layout.main}>
          <div data-app-sheet className={layout.scroller}>
            <div className="mx-auto w-full max-w-5xl flex-1">
              {/* Above the route so the org state reads the same on every page (#163). */}
              <OverLimitBanner />
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
          limit={user.limits.orgs}
          tier={user.tier}
        />
      </div>
    </NewLinkHost>
  );
}
