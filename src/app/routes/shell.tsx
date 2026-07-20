import { useState, type ReactNode } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import {
  LayoutDashboard,
  Link2,
  Users,
  Settings,
  Globe,
  CreditCard,
  Building2,
  UserCog,
  ChevronsUpDown,
  Plus,
  Check,
  Sun,
  Moon,
  LogOut,
  Menu as MenuIcon,
  X,
} from "lucide-react";
import { useCurrentUser, useLogout } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, ApiError } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button, IconButton } from "../ui/button";
import { Field, Input } from "../ui/field";

import { AppShellSkeleton, PageSkeleton } from "../components/skeletons";
import { cn } from "../ui/cn";
import { NotFound } from "./not-found";
import { PLAN_LIMITS } from "@/shared/types";

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  const location = useLocation();
  if (me.isLoading) return <AppShellSkeleton />;
  if (!me.data)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  return children;
}

/** Platform admin surface: 404s (not a redirect) for non-admins, so the
 * admin area's existence isn't revealed to regular users. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  if (me.isLoading) return <PageSkeleton />;
  if (!me.data?.user.isAdmin) return <NotFound />;
  return children;
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
    isActive
      ? "bg-surface-2 text-accent"
      : "text-muted hover:bg-surface-2/60 hover:text-text",
  );
}

export function AppShell() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useLogout();
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const { org, orgs, setOrg } = useCurrentOrg();

  if (!me.data) return null;
  // No org is fine: org-scoped pages render NoOrgState, billing is per-user.
  const { user } = me.data;

  // Multi-org is a Pro perk: the owned-org cap comes from the caller's plan.
  const ownedCount = orgs.filter((o) => o.role === "owner").length;
  const canCreateOrg = ownedCount < PLAN_LIMITS[user.plan].orgs;

  const switchOrg = (id: string) => {
    setOrg(id);
    navigate("/dashboard");
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
      setNewOrgOpen(false);
      setNewOrgName("");
      setOrg(created.id);
      navigate("/dashboard");
    } catch (e) {
      if (e instanceof ApiError && e.code === "org_limit")
        toast("Upgrade to Pro to create more organizations", "error");
      else toast((e as Error).message, "error");
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* brand — desktop only; on mobile the top bar already shows it */}
      <div className="hidden px-3 pt-4 pb-2 md:block">
        <span className="px-1.5 text-sm font-bold tracking-widest">
          rdyrct
        </span>
      </div>

      {/* org switcher */}
      <div className="px-3 py-2">
        <Menu
          trigger={
            <div className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm select-none hover:border-accent">
              <span className="truncate">
                {org ? org.name : "No organization"}
              </span>
              <ChevronsUpDown size={14} className="shrink-0 text-muted" />
            </div>
          }
        >
          {orgs.map((o) => (
            <MenuItem key={o.id} onClick={() => switchOrg(o.id)}>
              <span className="w-4">
                {o.id === org?.id && (
                  <Check size={13} className="text-accent" />
                )}
              </span>
              <span className="truncate">{o.name}</span>
              <span className="ml-auto text-[10px] text-muted uppercase">
                {o.role}
              </span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={() =>
              canCreateOrg
                ? setNewOrgOpen(true)
                : toast(
                    "Upgrade to Pro to create more organizations",
                    "error",
                  )
            }
          >
            <Plus size={14} className="text-muted" /> New organization
            {!canCreateOrg && (
              <span className="ml-auto text-[10px] text-accent uppercase">
                Pro
              </span>
            )}
          </MenuItem>
        </Menu>
      </div>

      {/* nav — always visible: org-scoped pages render their own empty state
          when no org exists yet, and billing is per-user */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        <NavLink to="/dashboard" className={navClass}>
          <LayoutDashboard size={15} /> Overview
        </NavLink>
        <NavLink to="/links" className={navClass}>
          <Link2 size={15} /> Links
        </NavLink>
        <NavLink to="/domains" className={navClass}>
          <Globe size={15} /> Domains
        </NavLink>
        <NavLink to="/members" className={navClass}>
          <Users size={15} /> Members
        </NavLink>
        <NavLink to="/billing" className={navClass}>
          <CreditCard size={15} /> Billing
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          <Settings size={15} /> Settings
        </NavLink>
      </nav>

      {/* platform admin */}
      {user.isAdmin && (
        <div className="mt-2 px-3">
          <p className="px-2.5 pb-1 text-[10px] tracking-widest text-muted uppercase">
            Platform
          </p>
          <nav className="flex flex-col gap-0.5">
            <NavLink to="/admin" end className={navClass}>
              <Globe size={15} /> Usage
            </NavLink>
            <NavLink to="/admin/orgs" className={navClass}>
              <Building2 size={15} /> Organizations
            </NavLink>
            <NavLink to="/admin/users" className={navClass}>
              <UserCog size={15} /> Users
            </NavLink>
          </nav>
        </div>
      )}

      {/* user footer — py-2.5 makes this block exactly as tall as the main
          Footer, so both border-t lines form one continuous bottom rule */}
      <div className="mt-auto border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 px-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <IconButton
            label="Toggle theme"
            className="p-2"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
          <IconButton
            label="Sign out"
            danger
            className="p-2"
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate("/login") })
            }
          >
            <LogOut size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface/40 md:block">
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
          {mobileOpen ? <X size={18} /> : <MenuIcon size={18} />}
        </button>
        <span className="text-sm font-bold tracking-widest">
          rdyrct
        </span>
      </div>
      <LazyMotion features={domAnimation}>
        <AnimatePresence>
          {mobileOpen && (
            <div className="fixed inset-0 z-20 md:hidden">
              {/* click-outside backdrop as a real button: keyboard-focusable and
                  labeled, while drawer clicks (sibling, not child) never reach it */}
              <button
                type="button"
                aria-label="Close menu"
                className="absolute inset-0 cursor-default"
                onClick={() => setMobileOpen(false)}
              />
              <m.div
                className="absolute top-[49px] bottom-0 left-0 w-64 border-r border-border bg-bg"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
              >
                {sidebar}
              </m.div>
            </div>
          )}
        </AnimatePresence>
      </LazyMotion>

      <main className="flex min-w-0 flex-1 flex-col px-5 py-8 pt-16 md:px-8 md:pt-8">
        <div className="mx-auto w-full max-w-5xl flex-1">
          <Outlet />
        </div>
      </main>

      <Dialog
        open={newOrgOpen}
        onOpenChange={setNewOrgOpen}
        title="New organization"
      >
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="acme inc"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && createOrg()}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewOrgOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createOrg}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
