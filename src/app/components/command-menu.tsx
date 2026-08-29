import { useEffect, useState, type ComponentType, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import { Layers, Link2, LogOut, Moon, Plus, Search, Sun, UserPlus, WorldWww } from "@/app/ui/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPill,
} from "@/app/ui/command";
import { appNavItems } from "./nav-items";
import { LinkPreviewDialog } from "./link-preview-dialog";
import { SameDestinationDialog } from "./same-destination-dialog";
import { useLinkMutations, useLinks, useLogout, useShellUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useOrgLimits } from "../lib/org-limits";
import { useDebounced } from "../lib/use-debounced";
import { useTheme } from "../lib/theme";
import { useToast } from "../ui/toast";
import { ApiError, shortUrl } from "../lib/api";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
import type { LinkDTO, LinkInput } from "@/shared/types";

type Action = {
  /** cmdk match string: label plus a few synonyms. */
  value: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: "Go to" | "Actions";
  danger?: boolean;
  disabled?: boolean;
  /** Shown regardless of the typed filter (e.g. the entry into link scope). */
  always?: boolean;
  run: () => void;
};

/**
 * The palette has three scopes. `all` filters pages and actions locally and
 * hits nothing; the network only wakes once you are `in` a scope. A `link:`
 * or `create:` prefix (Discord style) turns into a pill and switches scope;
 * Backspace on the empty field pops the pill.
 */
type Scope = "all" | "links" | "create";

const PILL_LABEL = { links: "link", create: "create" } satisfies Record<
  Exclude<Scope, "all">,
  string
>;

const PREFIXES: [RegExp, Exclude<Scope, "all">][] = [
  [/^(?:search )?links?:\s*/i, "links"],
  [/^create(?: link)?:\s*/i, "create"],
];

/** A prefix the field just gained, with the text left after it. */
function detectPill(value: string): { scope: Exclude<Scope, "all">; rest: string } | null {
  for (const [re, scope] of PREFIXES) {
    const m = value.match(re);
    if (m) return { scope, rest: value.slice(m[0].length) };
  }
  return null;
}

/** ⌘K opens on any key with a Cmd/Ctrl modifier and no Alt. */
function isToggleChord(e: globalThis.KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
}

/** Every word of the query has to appear somewhere in the item's text.
 * cmdk's own fuzzy filter is off (link results are server-filtered, and the
 * scope pill already narrowed things), so the static list matches here. */
function hit(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

/** A one-token string with a dot in it: enough to read as "make this a link". */
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || (/\.[a-z]{2,}/i.test(s) && !/\s/.test(s));
}

/**
 * One flat list of everything the palette can do, built from the current
 * user, org and theme. A later shortcuts sheet can render from the same
 * array.
 */
function useActions(close: () => void, enterLinks: () => void): Action[] {
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
      // No `act`: this swaps to the link pill, it does not leave the palette.
      value: "search links find open",
      label: "Search links",
      icon: Search,
      group: "Actions",
      always: true,
      run: enterLinks,
    },
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
      // No `act`: the palette stays open so you can flip back, and the
      // item's own label swaps as the theme changes.
      value: "toggle theme dark light appearance",
      label: flip.label,
      icon: flip.icon,
      group: "Actions",
      run: toggleTheme,
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

/** The current org's links matching `term`, capped at six. Only called with a
 * term while the `link` scope is active, so the palette never searches on a
 * stray keystroke. The query reaches the server, so it lags a keystroke. */
// Linear fetch-and-shape; the CRAP score is inflated by the nullable-data
// guards and fallow's assumed 0% coverage.
// fallow-ignore-next-line complexity
function useLinkMatches(term: string, close: () => void): LinkMatch[] {
  const navigate = useNavigate();
  const { org } = useCurrentOrg();
  const settled = useDebounced(term.trim());
  // orgId doubles as the query's enable switch: blank it and useLinks idles.
  const { data } = useLinks(settled ? (org?.id ?? "") : "", { q: settled, limit: 6 });
  const items = settled ? (data?.items ?? []) : [];
  return items.map((l) => ({
    key: `link:${l.domain ?? ""}:${l.slug}`,
    url: shortUrl(l.slug, l.domain),
    run: () => {
      close();
      navigate({ href: linkHref(l) });
    },
  }));
}

type Match = { input: LinkInput; matchedLinks: LinkDTO[] };

/**
 * Creating a link from the palette follows the dashboard's quick-create flow
 * exactly: on success the QR-and-short-URL dialog opens; when the
 * destination already has a link the same "add this address to it" dialog
 * offers to alias it or make a separate link (#38). Returns `start(url)` and
 * the two dialogs to render.
 */
// fallow-ignore-next-line complexity
function useLinkCreateFlow() {
  const { orgId, defaultDomainId, orgQr } = useOrgLimits();
  const toast = useToast();
  const { create } = useLinkMutations(orgId);
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const [match, setMatch] = useState<Match | null>(null);

  const submit = (input: LinkInput, extra: Partial<LinkInput>) =>
    create.mutate(
      { ...input, ...extra },
      {
        onSuccess: (link) => {
          setMatch(null);
          setCreated(link);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "same_destination_match") {
            // SAFETY: the route that sets same_destination_match attaches
            // matchedLinks alongside it, same shape the dashboard reads.
            const { matchedLinks } = e.data as { matchedLinks: LinkDTO[] };
            setMatch({ input, matchedLinks });
            return;
          }
          withErrorToast(toast)(e);
        },
      },
    );

  const start = (destination: string) => {
    const value = destination.trim();
    if (!v.safeParse(destinationSchema, { destination: value }).success) {
      toast("Enter a valid URL", "error");
      return;
    }
    submit({ destination: value, domainId: defaultDomainId }, {});
  };

  const dialogs = (
    <>
      <LinkPreviewDialog
        title="Link created"
        link={created}
        orgQr={orgQr}
        onClose={() => setCreated(null)}
      />
      <SameDestinationDialog
        matchedLinks={match?.matchedLinks ?? null}
        pending={create.isPending}
        onClose={() => setMatch(null)}
        onAddToExisting={(l) => match && submit(match.input, { mergeIntoLinkId: l.id })}
        onCreateSeparate={() => match && submit(match.input, { forceSeparateLink: true })}
      />
    </>
  );

  return { start, dialogs };
}

function CreateGroup({ arg, onRun }: { arg: string; onRun: (arg: string) => void }) {
  return (
    <CommandGroup heading="Create">
      <CommandItem value="__create" disabled={arg === ""} onSelect={() => onRun(arg)}>
        <Plus size={15} className="text-muted" />
        <span className="truncate">
          Create link for <span className="text-text">{arg || "…"}</span>
        </span>
      </CommandItem>
    </CommandGroup>
  );
}

function LinksGroup({ links }: { links: LinkMatch[] }) {
  if (links.length === 0) return null;
  return (
    <CommandGroup heading="Links">
      {links.map((l) => (
        <CommandItem key={l.key} value={l.key} onSelect={l.run}>
          <Link2 size={15} className="text-muted" />
          <span className="truncate">{l.url}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function ActionRow({ action }: { action: Action }) {
  const tint = action.danger ? "text-danger" : "text-muted";
  return (
    <CommandItem
      value={action.value}
      disabled={action.disabled}
      onSelect={action.run}
      className={action.danger ? "data-[selected=true]:bg-danger/10" : undefined}
    >
      <action.icon size={15} className={tint} />
      <span className={action.danger ? "text-danger" : undefined}>{action.label}</span>
    </CommandItem>
  );
}

function ActionGroup({ heading, items }: { heading: string; items: Action[] }) {
  if (items.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {items.map((a) => (
        <ActionRow key={a.value} action={a} />
      ))}
    </CommandGroup>
  );
}

const PLACEHOLDER = {
  all: "Search pages and actions…",
  links: "Search your links",
  create: "Paste or type a URL",
} satisfies Record<Scope, string>;

function matchingActions(actions: Action[], group: Action["group"], search: string): Action[] {
  return actions.filter(
    (a) => a.group === group && (a.always || hit(`${a.label} ${a.value}`, search)),
  );
}

/** The list contents for the current scope. `all` shows the filtered pages
 * and actions (a create item too when the query is a URL); the scoped views
 * show just their one thing. */
function PaletteBody({
  scope,
  search,
  actions,
  links,
  onCreate,
}: {
  scope: Scope;
  search: string;
  actions: Action[];
  links: LinkMatch[];
  onCreate: (arg: string) => void;
}) {
  if (scope !== "all") {
    return {
      links: <LinksGroup links={links} />,
      create: <CreateGroup arg={search} onRun={onCreate} />,
    }[scope];
  }
  return (
    <>
      {looksLikeUrl(search) && <CreateGroup arg={search} onRun={onCreate} />}
      <ActionGroup heading="Go to" items={matchingActions(actions, "Go to", search)} />
      <ActionGroup heading="Actions" items={matchingActions(actions, "Actions", search)} />
    </>
  );
}

/**
 * ⌘K / Ctrl+K command palette. Mounted once in AppShell, so it rides on every
 * app route. It is the one discoverable home for the shortcuts the app
 * otherwise keeps quiet (type or paste anywhere on the dashboard, and
 * whatever lands here next).
 *
 * Default scope filters pages and actions only. Type `link:` to search the
 * org's links, `create:` (or a bare URL) to make one, each shown as a pill.
 * The bare-keystroke listener on the dashboard ignores anything with a
 * modifier, so ⌘K never collides with it.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const close = () => setOpen(false);

  const actions = useActions(close, () => setScope("links"));
  const links = useLinkMatches(scope === "links" ? search : "", close);
  const { start, dialogs } = useLinkCreateFlow();

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Fresh each open.
  useEffect(() => {
    if (open) return;
    setScope("all");
    setSearch("");
  }, [open]);

  const onValueChange = (value: string) => {
    // Checked in every scope, not just `all`: a fast typist can land a
    // keystroke on the controlled field before React clears the prefix, so
    // the value can still arrive as "link:foo" while already in link scope.
    const pill = detectPill(value);
    if (pill) {
      setScope(pill.scope);
      setSearch(pill.rest);
    } else {
      setSearch(value);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Read the live value, not `search`: a controlled reset to "" can lag a
    // render behind the keystroke that empties the field.
    if (e.key === "Backspace" && e.currentTarget.value === "" && scope !== "all") {
      e.preventDefault();
      setScope("all");
    }
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} label="Command menu" shouldFilter={false}>
        <CommandInput
          placeholder={PLACEHOLDER[scope]}
          value={search}
          onValueChange={onValueChange}
          onKeyDown={onKeyDown}
          pill={
            scope === "all" ? undefined : (
              <CommandPill label={PILL_LABEL[scope]} onClear={() => setScope("all")} />
            )
          }
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <PaletteBody
            scope={scope}
            search={search}
            actions={actions}
            links={links}
            onCreate={(arg) => {
              close();
              start(arg);
            }}
          />
        </CommandList>
      </CommandDialog>

      {dialogs}
    </>
  );
}
