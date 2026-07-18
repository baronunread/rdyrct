import { useState, type ReactNode } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  useMatch,
  useNavigate,
  useLocation,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Link2,
  Users,
  Settings,
  Globe,
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
import { useMe, useLogout } from "../lib/hooks";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Spinner } from "../ui/misc";
import { cn } from "../ui/cn";

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  if (!me.data)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

/** /app → first org, or the admin area for org-less platform admins. */
export function AppIndex() {
  const me = useMe();
  if (!me.data) return null;
  const first = me.data.orgs[0];
  if (first) return <Navigate to={`/app/${first.id}`} replace />;
  if (me.data.user.isAdmin) return <Navigate to="/app/admin" replace />;
  return (
    <div className="p-8 text-sm text-muted">
      You are not a member of any organization yet. Ask for an invite link, or
      create an organization from the switcher.
    </div>
  );
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
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useLogout();
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const match = useMatch("/app/:orgId/*");
  const orgId =
    match && match.params.orgId !== "admin" ? match.params.orgId! : null;
  const org = me.data?.orgs.find((o) => o.id === orgId) ?? null;

  if (!me.data) return null;
  const { user, orgs } = me.data;

  const createOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    try {
      const created = await api<{ id: string }>("/orgs", {
        method: "POST",
        body: { name },
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      setNewOrgOpen(false);
      setNewOrgName("");
      navigate(`/app/${created.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4 pb-2">
        <span className="px-1.5 text-sm font-bold tracking-widest">
          shrtnr<span className="text-accent">·</span>
        </span>
      </div>

      {/* org switcher */}
      <div className="px-3 py-2">
        <Menu
          trigger={
            <div className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm hover:border-accent">
              <span className="truncate">
                {org ? org.name : orgs.length ? "Select org" : "No org"}
              </span>
              <ChevronsUpDown size={14} className="shrink-0 text-muted" />
            </div>
          }
        >
          {orgs.map((o) => (
            <MenuItem key={o.id} onClick={() => navigate(`/app/${o.id}`)}>
              <span className="w-4">
                {o.id === orgId && <Check size={13} className="text-accent" />}
              </span>
              <span className="truncate">{o.name}</span>
              <span className="ml-auto text-[10px] text-muted uppercase">
                {o.role}
              </span>
            </MenuItem>
          ))}
          {orgs.length > 0 && <MenuSeparator />}
          <MenuItem onClick={() => setNewOrgOpen(true)}>
            <Plus size={14} className="text-muted" /> New organization
          </MenuItem>
        </Menu>
      </div>

      {/* org nav */}
      {org && (
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          <NavLink to={`/app/${org.id}`} end className={navClass}>
            <LayoutDashboard size={15} /> Overview
          </NavLink>
          <NavLink to={`/app/${org.id}/links`} className={navClass}>
            <Link2 size={15} /> Links
          </NavLink>
          <NavLink to={`/app/${org.id}/members`} className={navClass}>
            <Users size={15} /> Members
          </NavLink>
          <NavLink to={`/app/${org.id}/settings`} className={navClass}>
            <Settings size={15} /> Settings
          </NavLink>
        </nav>
      )}

      {/* platform admin */}
      {user.isAdmin && (
        <div className="mt-2 px-3">
          <p className="px-2.5 pb-1 text-[10px] tracking-widest text-muted uppercase">
            Platform
          </p>
          <nav className="flex flex-col gap-0.5">
            <NavLink to="/app/admin" end className={navClass}>
              <Globe size={15} /> Usage
            </NavLink>
            <NavLink to="/app/admin/orgs" className={navClass}>
              <Building2 size={15} /> Organizations
            </NavLink>
            <NavLink to="/app/admin/users" className={navClass}>
              <UserCog size={15} /> Users
            </NavLink>
          </nav>
        </div>
      )}

      {/* user footer */}
      <div className="mt-auto border-t border-border px-3 py-3">
        <div className="flex items-center gap-2 px-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="cursor-pointer rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate("/login") })
            }
            aria-label="Sign out"
            className="cursor-pointer rounded-md p-2 text-muted hover:bg-surface-2 hover:text-danger"
          >
            <LogOut size={15} />
          </button>
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
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="text-sm font-bold tracking-widest">
          shrtnr<span className="text-accent">·</span>
        </span>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Menu"
          className="cursor-pointer rounded-md p-1.5 text-muted hover:text-text"
        >
          {mobileOpen ? <X size={18} /> : <MenuIcon size={18} />}
        </button>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute top-[49px] bottom-0 left-0 w-64 border-r border-border bg-bg"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-5 py-8 pt-16 md:px-8 md:pt-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>

      <Dialog open={newOrgOpen} onOpenChange={setNewOrgOpen} title="New organization">
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
