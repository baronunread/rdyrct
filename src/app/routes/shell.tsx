import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { Globe, ChevronsUpDown, Plus, Check, LogOut } from "lucide-react";
// MorphIcon animates between two icons, so it takes lucide icon nodes, not
// the React components lucide-react exports.
import { Sun, Moon, Menu as MenuIcon, X } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useCurrentUser, useLogout, useShellUser } from "../lib/hooks";
import { useShellOrgs } from "../lib/current-org";
import { claimPendingLinks, storedAnonLinks } from "../lib/anon-links";
import { api, ApiError } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button, IconButton } from "../ui/button";
import { Field, Input } from "../ui/field";

import { AppShellSkeleton, RouteSkeleton } from "../components/skeletons";
import { appNavItems } from "../components/nav-items";
import { NotFound } from "./not-found";
import { PLAN_LIMITS, type User, type UserOrg } from "@/shared/types";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";

const ORG_LIMIT_MESSAGE = "Upgrade to Pro to create more organizations";

/** Friendly message for a failed org-create request: the org-limit error
 * gets an upgrade nudge, everything else shows the server's own message. */
function orgCreateErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "org_limit") return ORG_LIMIT_MESSAGE;
  return errorMessage(cause);
}

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
  if (currentUser.isLoading) return <RouteSkeleton />;
  if (!currentUser.data?.user.isAdmin) return <NotFound />;
  return children;
}

const navLinkProps = {
  className: "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
  activeProps: { className: "bg-surface-2 text-accent" },
  inactiveProps: { className: "text-muted hover:bg-surface-2/60 hover:text-text" },
};

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
        <div className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm select-none hover:border-accent">
          <span className="truncate">{org ? org.name : "No organization"}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted" />
        </div>
      }
      label="Switch organization"
    >
      {orgs.map((o) => (
        <MenuItem key={o.id} onClick={() => onSwitchOrg(o.id)}>
          <span className="w-4">
            {o.id === org?.id && <Check size={13} className="text-accent" />}
          </span>
          <span className="truncate">{o.name}</span>
          <span className="ml-auto text-xs text-muted">{o.role}</span>
        </MenuItem>
      ))}
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
          <Globe size={15} /> Platform
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
  return (
    <div className="flex h-full flex-col">
      {/* brand — desktop only; on mobile the top bar already shows it */}
      <div className="hidden px-3 pt-4 pb-2 md:block">
        <span className="px-1.5 text-sm font-bold tracking-widest">rdyrct</span>
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
        {appNavItems.map(({ to, icon: Icon, label }) => (
          <Link key={to} to={to} {...navLinkProps}>
            <Icon size={15} /> {label}
          </Link>
        ))}
      </nav>

      <PlatformNav visible={user.isAdmin} />

      {/* user footer — py-2.5 makes this block exactly as tall as the main
          Footer, so both border-t lines form one continuous bottom rule */}
      <div className="mt-auto border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 px-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <IconButton label="Toggle theme" className="p-2" onClick={onToggleTheme}>
            <MorphIcon icon={theme === "dark" ? Sun : Moon} size={15} spring="snappy" />
          </IconButton>
          <IconButton
            label="Sign out"
            danger
            className="p-2"
            disabled={signOutPending}
            onClick={onSignOut}
          >
            <LogOut size={15} />
          </IconButton>
        </div>
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
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-20 md:hidden">
            {/* click-outside backdrop as a real button: keyboard-focusable and
                labeled, while drawer clicks (sibling, not child) never reach it */}
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 cursor-default"
              onClick={onClose}
            />
            <m.div
              className="absolute top-[49px] bottom-0 left-0 w-64 border-r border-border bg-bg"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </m.div>
          </div>
        )}
      </AnimatePresence>
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
    <div className="flex min-h-dvh">
      {/* desktop sidebar: fixed so it never moves, not even on overscroll */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 border-r border-border bg-surface/40 md:block">
        {sidebar}
      </aside>

      {/* mobile top bar + drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Menu"
          className="cursor-pointer rounded-md p-1.5 text-muted hover:text-text"
        >
          <MorphIcon icon={mobileOpen ? X : MenuIcon} size={18} spring="snappy" />
        </button>
        <span className="text-sm font-bold tracking-widest">rdyrct</span>
      </div>
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)}>
        {sidebar}
      </MobileDrawer>

      <main className="flex min-w-0 flex-1 flex-col px-5 py-8 pt-16 md:ml-60 md:px-8 md:pt-8">
        <div className="mx-auto w-full max-w-5xl flex-1">
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
  );
}
