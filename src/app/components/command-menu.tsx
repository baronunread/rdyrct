import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Layers, LogOut, Moon, Plus, Sun, UserPlus, WorldWww } from "@/app/ui/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/app/ui/command";
import { appNavItems } from "./nav-items";
import { useLogout, useShellUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";

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
  const actions = useActions(() => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const groups = ["Go to", "Actions"] as const;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} label="Command menu">
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {actions
              .filter((a) => a.group === group)
              .map((a) => (
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
        ))}
      </CommandList>
    </CommandDialog>
  );
}
