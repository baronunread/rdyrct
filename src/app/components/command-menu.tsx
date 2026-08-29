import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Layers, Link2, LogOut, Moon, Plus, Sun, UserPlus, WorldWww } from "@/app/ui/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/app/ui/command";
import { appNavItems } from "./nav-items";
import { useLinks, useLogout, useShellUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useDebounced } from "../lib/use-debounced";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { shortUrl } from "../lib/api";
import type { LinkDTO } from "@/shared/types";

type Action = {
  /** cmdk match string: label plus a few synonyms. */
  value: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: "Go to" | "Actions";
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
};

/** ⌘K opens on any key with a Cmd/Ctrl modifier and no Alt. */
function isToggleChord(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
}

/** Every word of the query has to appear somewhere in the item's text.
 * cmdk's own fuzzy filter is off (link results are already server-filtered),
 * so the static list matches here instead. */
function hit(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

/**
 * One flat list of everything the palette can do, built from the current
 * user, org and theme. A later shortcuts sheet can render from the same
 * array.
 */
function useActions(close: () => void): Action[] {
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const shell = useShellUser();
  const { org } = useCurrentOrg();
  const logout = useLogout();
  const toast = useToast();

  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const goto = (to: string) => act(() => navigate({ to }));
  // A locked org takes no writes from anyone until it is active again (#160).
  const locked = !!org?.locked;
  const flip =
    theme === "dark" ? { label: "Light theme", icon: Sun } : { label: "Dark theme", icon: Moon };

  const nav: Action[] = appNavItems.map(({ to, icon, label }) => ({
    value: `go ${label}`,
    label,
    icon,
    group: "Go to",
    run: goto(to),
  }));
  if (shell?.user.isAdmin) {
    nav.push({
      value: "go admin platform",
      label: "Admin",
      icon: Layers,
      group: "Go to",
      run: goto("/admin"),
    });
  }

  const actions: Action[] = [
    {
      value: "create link new",
      label: "Create link",
      icon: Plus,
      group: "Actions",
      disabled: locked,
      run: goto("/dashboard"),
    },
    {
      value: "add domain",
      label: "Add domain",
      icon: WorldWww,
      group: "Actions",
      disabled: locked,
      run: goto("/domains"),
    },
    {
      value: "invite member",
      label: "Invite member",
      icon: UserPlus,
      group: "Actions",
      disabled: locked,
      run: goto("/members"),
    },
    {
      value: "toggle theme dark light appearance",
      label: flip.label,
      icon: flip.icon,
      group: "Actions",
      run: act(toggleTheme),
    },
    {
      value: "sign out log out",
      label: "Sign out",
      icon: LogOut,
      group: "Actions",
      danger: true,
      run: act(() =>
        logout.mutate(undefined, {
          onSuccess: () => navigate({ to: "/login" }),
          onError: (e) => toast(e.message, "error"),
        }),
      ),
    },
  ];

  return [...nav, ...actions];
}

type LinkMatch = { key: string; url: string; run: () => void };

function linkHref(l: LinkDTO): string {
  return l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;
}

/** The current org's links matching the typed term, capped at six. The query
 * reaches the server (the list is paged), so it lags a keystroke. */
// Linear fetch-and-shape; the CRAP score is inflated by the nullable-data
// guards and fallow's assumed 0% coverage.
// fallow-ignore-next-line complexity
function useLinkMatches(search: string, close: () => void): LinkMatch[] {
  const navigate = useNavigate();
  const { org } = useCurrentOrg();
  const term = useDebounced(search.trim());
  // orgId doubles as the query's enable switch: blank it and useLinks idles.
  const { data } = useLinks(term ? (org?.id ?? "") : "", { q: term, limit: 6 });
  const items = term ? (data?.items ?? []) : [];
  return items.map((l) => ({
    key: `link:${l.domain ?? ""}:${l.slug}`,
    url: shortUrl(l.slug, l.domain),
    run: () => {
      close();
      navigate({ href: linkHref(l) });
    },
  }));
}

/**
 * ⌘K / Ctrl+K command palette. Mounted once in AppShell, so it rides on every
 * app route. It is the one discoverable home for the shortcuts the app
 * otherwise keeps quiet (type or paste anywhere on the dashboard, and
 * whatever lands here next).
 *
 * The bare-keystroke listener on the dashboard ignores anything with a
 * modifier, so ⌘K never collides with it.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => setOpen(false);
  const actions = useActions(close);
  const links = useLinkMatches(search, close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Fresh each open: a stale term would show stale results for a frame.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const groups = ["Go to", "Actions"] as const;
  const shown = (a: Action) => hit(`${a.label} ${a.value}`, search);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} label="Command menu" shouldFilter={false}>
      <CommandInput
        placeholder="Search pages, links and actions…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {links.length > 0 && (
          <CommandGroup heading="Links">
            {links.map((l) => (
              <CommandItem key={l.key} value={l.key} onSelect={l.run}>
                <Link2 size={15} className="text-muted" />
                <span className="truncate">{l.url}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.map((group) => {
          const items = actions.filter((a) => a.group === group && shown(a));
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {items.map((a) => (
                <CommandItem
                  key={a.value}
                  value={a.value}
                  disabled={a.disabled}
                  onSelect={a.run}
                  className={a.danger ? "data-[selected=true]:bg-danger/10" : undefined}
                >
                  <a.icon size={15} className={a.danger ? "text-danger" : "text-muted"} />
                  <span className={a.danger ? "text-danger" : undefined}>{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
