import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Layers, ChevronsUpDown, Plus, LogOut, Search, Settings } from "@/app/ui/icons";
import { MorphIcon } from "morphicons/react";
import { menu2, moon, sun, x } from "@/app/ui/icon-nodes";
import { useCurrentUser, useLogout, useShellUser } from "../lib/hooks";
import { useShellOrgs } from "../lib/current-org";
import { claimPendingLinks, storedAnonLinks } from "../lib/anon-links";
import { api, ApiError } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";

import { AdminPlatformSkeleton, AppShellSkeleton, RouteSkeleton } from "../components/skeletons";
import { appNavItems } from "../components/nav-items";
import { OverLimitBanner } from "../components/over-limit";
import { UserAvatar } from "../components/user-avatar";
import { CommandMenu } from "../components/command-menu";
import { NewLinkHost } from "../components/new-link-host";
import { OrgMenuItems } from "../components/org-menu-items";
import { WebMcpLinkTools } from "../components/webmcp-link-tools";
import { WebMcpAnalyticsTool } from "../components/webmcp-analytics-tool";
import { NotFound } from "./not-found";
import { PLAN_LIMITS, type User, type UserOrg } from "@/shared/types";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { Logo } from "../ui/logo";

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
  if (!currentUser.data?.user.isAdmin) return <NotFound />;
  return children;
}

// The current page is lifted onto the surface, like the sheet beside it, with
// its icon in the accent: one raised thing in the sidebar, not a tinted well.
const navLinkProps = {
  className:
    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-[background-color,color] [&_svg]:shrink-0",
  activeProps: {
    className: "bg-surface font-medium text-text smooth-shadow-ring-xs [&_svg]:text-accent",
  },
  inactiveProps: {
    className:
      "text-muted [@media(hover:hover)]:hover:bg-surface/50 [@media(hover:hover)]:hover:text-text",
  },
};

/** Opens the command menu the way its own shortcut does. */
function openCommandMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
}

function OrgSwitcherMenu({
  org,
  orgs,
  onSwitchOrg,
  canCreateOrg,
  onNewOrg,
}: {
  org: UserOrg | null;
  orgs: UserOrg[];
  onSwitchOrg: (id: string) => void;
  canCreateOrg: boolean;
  onNewOrg: () => void;
}) {
  return (
    <Menu
      trigger={
        <div className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-sm select-none [@media(hover:hover)]:hover:bg-surface-2">
          {/* The org's initial, so a glance tells two orgs apart. */}
          {org && (
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-bg"
            >
              {org.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate font-semibold">
            {org ? org.name : "No organization"}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted" />
        </div>
      }
      label="Switch organization"
    >
      <OrgMenuItems orgs={orgs} currentId={org?.id} onPick={onSwitchOrg} />
      <MenuSeparator />
      <MenuItem onClick={onNewOrg}>
        <Plus size={14} className="text-muted" /> New organization
        {!canCreateOrg && <span className="ml-auto text-xs text-accent">Pro</span>}
      </MenuItem>
    </Menu>
  );
}

/**
 * One entry, not four. The four sections are tabs inside /admin now: as
 * sidebar items they sat directly under the organization's own nav, where
 * "Links" appeared twice meaning two different things.
 */
function PlatformNav({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="mt-2 px-3">
      <p className="px-2.5 pb-1 text-xs font-medium text-muted">Admin</p>
      <nav className="flex flex-col gap-0.5">
        <Link to="/admin" {...navLinkProps}>
          <Layers size={15} /> Platform
        </Link>
      </nav>
    </div>
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
}: {
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
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col">
      {/* brand — desktop only; on mobile the top bar already shows it */}
      <div className="hidden px-3 pt-4 pb-2 md:block">
        <Logo className="px-1.5 text-sm" />
      </div>

      {/* org switcher */}
      <div className="px-3 py-2">
        <OrgSwitcherMenu
          org={org}
          orgs={orgs}
          onSwitchOrg={onSwitchOrg}
          canCreateOrg={canCreateOrg}
          onNewOrg={onNewOrg}
        />
      </div>

      {/* nav — always visible: org-scoped pages render their own empty state
          when no org exists yet, and billing is per-user */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {appNavItems
          .filter(({ to }) => to !== "/billing" || user.plan !== "unlimited")
          .map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} {...navLinkProps}>
              <Icon size={15} /> {label}
            </Link>
          ))}
      </nav>

      <PlatformNav visible={user.isAdmin} />

      {/* user footer — py-2.5 makes this block exactly as tall as the main
          Footer, so both border-t lines form one continuous bottom rule */}
      <div className="mt-auto px-3 py-3">
        <Menu
          label="Account menu"
          trigger={
            <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 [@media(hover:hover)]:hover:bg-surface/50">
              <UserAvatar user={user} size={30} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </span>
              <ChevronsUpDown size={14} className="shrink-0 text-muted" />
            </div>
          }
        >
          <MenuItem onClick={openCommandMenu}>
            <Search size={15} /> Search and commands
            <kbd className="ml-auto rounded-md px-1.5 font-mono text-2xs text-muted smooth-shadow-ring-xs">
              ⌘K
            </kbd>
          </MenuItem>
          <MenuItem onClick={() => void navigate({ to: "/settings" })}>
            <Settings size={15} /> Settings
          </MenuItem>
          <MenuItem closeOnClick={false} onClick={onToggleTheme}>
            <MorphIcon icon={theme === "dark" ? sun : moon} size={15} spring="snappy" />
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-danger" disabled={signOutPending} onClick={onSignOut}>
            <LogOut size={15} /> Sign out
          </MenuItem>
        </Menu>
      </div>
    </div>
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
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-20 md:hidden">
              {/* click-outside backdrop as a real button: keyboard-focusable and
                labeled, while drawer clicks (sibling, not child) never reach it */}
              {/* A dimmed page behind the drawer says it is on top and that a
                  tap outside closes it. A real button, so it is reachable. */}
              <m.button
                type="button"
                aria-label="Close menu"
                className="absolute inset-0 cursor-default bg-black/35"
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
              <m.div
                className="absolute top-[52px] bottom-1.5 left-1.5 w-72 rounded-[20px] bg-bg smooth-shadow-ring-xl"
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

function NewOrgDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New organization">
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="acme inc"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onCreate}>
            Create
          </Button>
        </div>
      </div>
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

export function AppShell() {
  const shell = useShellUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useLogout();
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const sidebar = (
    <AppSidebar
      org={org}
      orgs={orgs}
      onSwitchOrg={switchOrg}
      canCreateOrg={canCreateOrg}
      onNewOrg={onNewOrg}
      user={user}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSignOut={onSignOut}
      signOutPending={logout.isPending}
    />
  );

  return (
    <NewLinkHost>
      <div className="flex min-h-dvh">
        <CommandMenu />
        <WebMcpLinkTools />
        <WebMcpAnalyticsTool />
        {/* desktop sidebar: fixed so it never moves, not even on overscroll */}
        <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 md:block">{sidebar}</aside>

        {/* mobile top bar + drawer */}
        <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
            className="cursor-pointer rounded-md p-1.5 text-muted hover:text-text"
          >
            <MorphIcon icon={mobileOpen ? x : menu2} size={18} spring="snappy" />
          </button>
          <Logo className="text-sm" />
        </div>
        <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)}>
          {sidebar}
        </MobileDrawer>

        {/* One raised sheet for the page; the sidebar and the phone bar sit on
          the paper behind it (rdyrct-design, "The app's surfaces"). */}
        <main className="mx-1.5 mt-[52px] mb-1.5 flex min-w-0 flex-1 flex-col rounded-[22px] bg-surface px-4 py-6 smooth-shadow-ring-sm md:my-2 md:mr-2 md:ml-[248px] md:rounded-[14px] md:px-10 md:py-8">
          <div className="mx-auto w-full max-w-5xl flex-1">
            {/* Above the route, not inside each one: the state belongs to the
              org, so it says the same thing on every page (#163). */}
            <OverLimitBanner />
            {/* pages are lazy chunks: keep the shell in place while one loads,
              behind the shape that chunk is about to render */}
            <Suspense fallback={<RouteSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <NewOrgDialog
          open={newOrgOpen}
          onOpenChange={setNewOrgOpen}
          name={newOrgName}
          onNameChange={setNewOrgName}
          onCreate={createOrg}
        />
      </div>
    </NewLinkHost>
  );
}
