import { useEffect, useState, type ComponentType, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import {
  ArrowUpDown,
  Copy,
  Layers,
  Link2,
  LogOut,
  Moon,
  Plus,
  Search,
  Sun,
  UserPlus,
  WorldWww,
} from "@/app/ui/icons";
import { CommandPill } from "@/app/ui/command";
import {
  CommandSheet,
  Highlight,
  IconTile,
  PaletteEmpty,
  PaletteFooter,
  PaletteGroup,
  PaletteInput,
  PaletteItem,
  PaletteList,
  RowKeys,
} from "./command-sheet";
import { useInviteFlow, useLinkCreateFlow } from "./command-flows";
import { appNavItems } from "./nav-items";
import { useNewLink } from "./new-link-host";
import { useLinks, useLogout, useShellUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useDebounced } from "../lib/use-debounced";
import { useTheme } from "../lib/theme";
import { GO_KEYS } from "../lib/go-shortcuts";
import { formatNumber } from "../lib/numbers";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { cn } from "../ui/cn";
import type { LinkDTO } from "@/shared/types";

type Action = {
  /** Unique id, plus a few synonyms the query also matches. */
  value: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: "pages" | "actions";
  /** The keys that do the same thing anywhere in the app. */
  keys?: readonly string[];
  danger?: boolean;
  disabled?: boolean;
  /** Only once something is typed: rare enough not to crowd the opening list. */
  searchOnly?: boolean;
  run: () => void;
};

/**
 * The palette has three scopes. `all` searches links, pages and actions as
 * you type. A `link:` or `create:` prefix (Discord style) turns into a pill
 * and narrows it to one thing; Backspace on the empty field pops the pill.
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

/** Every word of the query has to appear somewhere in the item's text. */
function hit(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

/** A one-token string with a dot in it: enough to read as "make this a link".
 * An `@` rules it out so `name@host.com` is only ever read as an email. */
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || (/\.[a-z]{2,}/i.test(s) && !/\s/.test(s) && !s.includes("@"));
}

const EMAIL = v.pipe(v.string(), v.email());

/** A bare email address: offer to invite it to the current org. */
function looksLikeEmail(s: string): boolean {
  return v.safeParse(EMAIL, s.trim()).success;
}

/** "G D", for a page that has a go-to pair. */
function goKeys(to: string): readonly string[] | undefined {
  const key = Object.entries(GO_KEYS).find(([path]) => path === to)?.[1];
  return key ? ["G", key] : undefined;
}

/** Switch the current org, then stay put unless the route names a link (its
 * slug may not exist under the new org). Mirrors the sidebar switcher. */
function makeSwitchTo(
  close: () => void,
  setOrg: (id: string) => void,
  navigate: ReturnType<typeof useNavigate>,
): (id: string) => void {
  return (id) => {
    close();
    setOrg(id);
    if (window.location.pathname.startsWith("/links/")) navigate({ to: "/dashboard" });
  };
}

/** "Switch to <Org>" for every org the user is in except the current one. */
function switchOrgActions(
  orgs: { id: string; name: string }[],
  currentId: string | undefined,
  switchTo: (id: string) => void,
): Action[] {
  return orgs.flatMap((o) =>
    o.id === currentId
      ? []
      : [
          {
            value: `switch organization ${o.name}`,
            label: `Switch to ${o.name}`,
            icon: ArrowUpDown,
            group: "actions" as const,
            searchOnly: true,
            run: () => switchTo(o.id),
          },
        ],
  );
}

/**
 * One flat list of the pages and actions the palette offers, built from the
 * current user, org and theme.
 */
// A registry builder: the CRAP score is optional-chain and zero-coverage
// noise over a handful of plain conditionals.
// fallow-ignore-next-line complexity
function useActions(close: () => void): Action[] {
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const shell = useShellUser();
  const { org, orgs, setOrg } = useCurrentOrg();
  const logout = useLogout();
  const toast = useToast();
  const { openNewLink } = useNewLink();

  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const goto = (to: string) => act(() => navigate({ to }));
  // A locked org takes no writes from anyone until it is active again (#160).
  const locked = !!org?.locked;
  const flip =
    theme === "dark" ? { label: "Light theme", icon: Sun } : { label: "Dark theme", icon: Moon };

  // Nothing to buy on a self-hosted instance, so no billing page to go to.
  const pages: Action[] = appNavItems
    .filter(({ to }) => to !== "/billing" || shell?.user.plan !== "unlimited")
    .map(({ to, icon, label }) => ({
      value: `go ${label}`,
      label,
      icon,
      group: "pages",
      keys: goKeys(to),
      run: goto(to),
    }));
  if (shell?.user.isAdmin) {
    pages.push({
      value: "go admin platform",
      label: "Platform",
      icon: Layers,
      group: "pages",
      run: goto("/admin"),
    });
  }

  const actions: Action[] = [
    {
      value: "create link new",
      label: "Create link",
      icon: Plus,
      group: "actions",
      keys: ["C"],
      disabled: locked,
      // The same dialog the header button and the C key open.
      run: act(openNewLink),
    },
    {
      value: "add domain",
      label: "Add domain",
      icon: WorldWww,
      group: "actions",
      disabled: locked,
      run: goto("/domains"),
    },
    {
      value: "invite member",
      label: "Invite member",
      icon: UserPlus,
      group: "actions",
      disabled: locked,
      run: goto("/members"),
    },
    {
      // No `act`: the palette stays open so you can flip back, and the
      // item's own label swaps as the theme changes.
      value: "toggle theme dark light appearance",
      label: flip.label,
      icon: flip.icon,
      group: "actions",
      run: toggleTheme,
    },
    ...switchOrgActions(orgs, org?.id, makeSwitchTo(close, setOrg, navigate)),
    {
      value: "sign out log out",
      label: "Sign out",
      icon: LogOut,
      group: "actions",
      danger: true,
      searchOnly: true,
      run: act(() =>
        logout.mutate(undefined, {
          onSuccess: () => navigate({ to: "/login" }),
          onError: (e) => toast(e.message, "error"),
        }),
      ),
    },
  ];

  return [...pages, ...actions];
}

function linkValue(l: LinkDTO): string {
  return `link:${l.domain ?? ""}:${l.slug}`;
}

function linkHref(l: LinkDTO): string {
  return l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;
}

/**
 * Links for the palette: the three newest while the field is empty, and the
 * matches for what is typed once it settles. Both only while it is open, so a
 * closed palette costs nothing. The term reaches the server, so the list
 * lags a keystroke behind the pages and actions.
 */
function usePaletteLinks(open: boolean, term: string, limit: number) {
  const { org } = useCurrentOrg();
  const settled = useDebounced(term.trim(), 200);
  // orgId doubles as the query's enable switch: blank it and useLinks idles.
  const orgId = open ? (org?.id ?? "") : "";
  const recent = useLinks(settled ? "" : orgId, { limit: 3 });
  const found = useLinks(settled ? orgId : "", { q: settled, limit });
  if (!open) return { recent: [], found: [] };
  return {
    recent: settled ? [] : (recent.data?.items ?? []),
    found: settled ? (found.data?.items ?? []) : [],
  };
}

function LinkRow({
  link,
  query,
  onOpen,
}: {
  link: LinkDTO;
  query: string;
  onOpen: (l: LinkDTO) => void;
}) {
  const toast = useToast();
  const title = link.title || link.destination;
  return (
    <PaletteItem value={linkValue(link)} onSelect={() => onOpen(link)} className="group">
      <IconTile>
        <Link2 size={14} />
      </IconTile>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
        <span className="shrink-0 font-mono text-[0.8125rem]">
          /<Highlight text={link.slug} query={query} />
        </span>
        <span className="truncate text-muted">
          <Highlight text={title} query={query} />
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted tabular-nums">
        {formatNumber(link.clicks)} {link.clicks === 1 ? "click" : "clicks"}
      </span>
      <button
        type="button"
        aria-label={`Copy ${link.url}`}
        // Stop the press from selecting the row (which would navigate).
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void copyToClipboard(link.url, toast).catch(() => {});
        }}
        className="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted opacity-0 transition-opacity duration-100 group-data-[selected=true]:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:hover:text-text"
      >
        <Copy size={14} />
      </button>
    </PaletteItem>
  );
}

function ActionRow({ action, query }: { action: Action; query: string }) {
  return (
    <PaletteItem
      value={action.value}
      disabled={action.disabled}
      onSelect={action.run}
      className={action.danger ? "data-[selected=true]:bg-danger/10" : undefined}
    >
      <IconTile className={action.danger ? "text-danger" : undefined}>
        <action.icon size={15} />
      </IconTile>
      <span className={cn("min-w-0 flex-1 truncate", action.danger && "text-danger")}>
        <Highlight text={action.label} query={query} />
      </span>
      {action.keys && <RowKeys keys={action.keys} />}
    </PaletteItem>
  );
}

function matching(actions: Action[], group: Action["group"], search: string): Action[] {
  const q = search.trim();
  return actions.filter(
    (a) => a.group === group && (q === "" ? !a.searchOnly : hit(`${a.label} ${a.value}`, q)),
  );
}

/**
 * The list for the current scope, and how many rows it holds.
 *
 * Empty field: recent links, every page, the common actions. Typing: the
 * links, pages and actions that match, the match in the accent, and a last
 * row that widens the search to every link. A URL offers to make a link; an
 * email address, to invite it.
 */
// fallow-ignore-next-line complexity
function usePaletteBody({
  open,
  scope,
  search,
  actions,
  onOpenLink,
  onCreate,
  onInvite,
  onSearchAll,
}: {
  open: boolean;
  scope: Scope;
  search: string;
  actions: Action[];
  onOpenLink: (l: LinkDTO) => void;
  onCreate: (arg: string) => void;
  onInvite: (email: string) => void;
  onSearchAll: () => void;
}) {
  const q = search.trim();
  const { recent, found } = usePaletteLinks(
    open && scope !== "create",
    scope === "create" ? "" : search,
    scope === "links" ? 20 : 4,
  );

  if (scope === "create") {
    return {
      first: "__create",
      count: undefined,
      body: (
        <PaletteGroup heading="Create">
          <CreateRow arg={q} onRun={onCreate} />
        </PaletteGroup>
      ),
    };
  }

  const linkRows = (heading: string, list: LinkDTO[]) =>
    list.length > 0 && (
      <PaletteGroup heading={heading}>
        {list.map((l) => (
          <LinkRow key={l.id} link={l} query={q} onOpen={onOpenLink} />
        ))}
      </PaletteGroup>
    );

  if (scope === "links") {
    return {
      first: found[0] ? linkValue(found[0]) : "",
      count: q ? found.length : undefined,
      body: linkRows("Links", found),
    };
  }

  const pages = matching(actions, "pages", search);
  const acts = matching(actions, "actions", search);
  const url = looksLikeUrl(q);
  const email = looksLikeEmail(q);
  const extra = (url ? 1 : 0) + (email ? 1 : 0) + (q ? 1 : 0);
  const shownLinks = q ? found : recent;
  const firstAction = [...pages, ...acts].find((a) => !a.disabled);
  // What a press of Enter runs: the row the list opens on.
  const first = url
    ? "__create"
    : email
      ? "__invite"
      : shownLinks[0]
        ? linkValue(shownLinks[0])
        : (firstAction?.value ?? "__search-all");
  return {
    first,
    count: q ? found.length + pages.length + acts.length + extra : undefined,
    body: (
      <>
        {url && (
          <PaletteGroup heading="Create">
            <CreateRow arg={q} onRun={onCreate} />
          </PaletteGroup>
        )}
        {email && (
          <PaletteGroup heading="Invite">
            <PaletteItem value="__invite" onSelect={() => onInvite(q)}>
              <IconTile>
                <UserPlus size={15} />
              </IconTile>
              <span className="truncate">
                Invite <span className="font-mono text-[0.8125rem]">{q}</span>
              </span>
            </PaletteItem>
          </PaletteGroup>
        )}
        {q ? linkRows("Links", found) : linkRows("Recent links", recent)}
        {pages.length > 0 && (
          <PaletteGroup heading={q ? "Pages" : "Go to"}>
            {pages.map((a) => (
              <ActionRow key={a.value} action={a} query={q} />
            ))}
          </PaletteGroup>
        )}
        {(acts.length > 0 || q) && (
          <PaletteGroup heading="Actions">
            {acts.map((a) => (
              <ActionRow key={a.value} action={a} query={q} />
            ))}
            {q && (
              <PaletteItem value="__search-all" onSelect={onSearchAll}>
                <IconTile>
                  <Search size={15} />
                </IconTile>
                <span className="min-w-0 flex-1 truncate">
                  Search all links for “<Highlight text={q} query={q} />”
                </span>
              </PaletteItem>
            )}
          </PaletteGroup>
        )}
      </>
    ),
  };
}

function CreateRow({ arg, onRun }: { arg: string; onRun: (arg: string) => void }) {
  return (
    <PaletteItem value="__create" disabled={arg === ""} onSelect={() => onRun(arg)}>
      <IconTile>
        <Plus size={15} />
      </IconTile>
      <span className="truncate">
        Create link for <span className="font-mono text-[0.8125rem]">{arg || "…"}</span>
      </span>
    </PaletteItem>
  );
}

const PLACEHOLDER = {
  all: "Search links, pages and actions",
  links: "Search your links",
  create: "Paste or type a URL",
} satisfies Record<Scope, string>;

/**
 * ⌘K / Ctrl+K: find a link, go to a page, or do something. Mounted once in
 * AppShell, so it rides on every app route. It is also where the app's
 * quieter shortcuts are written down: each page and action shows its keys
 * (G D, C), and the footer shows the palette's own.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const close = () => setOpen(false);

  const actions = useActions(close);
  const { start, dialogs } = useLinkCreateFlow();
  const invite = useInviteFlow(close);
  const [selected, setSelected] = useState("");
  const { first, count, body } = usePaletteBody({
    open,
    scope,
    search,
    actions,
    onOpenLink: (l) => {
      close();
      void navigate({ href: linkHref(l) });
    },
    onCreate: (arg) => {
      close();
      start(arg);
    },
    onInvite: invite,
    onSearchAll: () => setScope("links"),
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The highlight goes back to the top whenever the list under it changes
  // (a keystroke, or the links arriving), so Enter runs the best match
  // rather than whatever row happened to exist first.
  const [listKey, setListKey] = useState("");
  const nextKey = `${scope}|${search}|${first}`;
  if (listKey !== nextKey) {
    setListKey(nextKey);
    setSelected(first);
  }

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
      <CommandSheet
        open={open}
        onOpenChange={setOpen}
        label="Search and commands"
        value={selected}
        onValueChange={setSelected}
      >
        <PaletteInput
          placeholder={PLACEHOLDER[scope]}
          value={search}
          onValueChange={onValueChange}
          onKeyDown={onKeyDown}
          count={count}
          pill={
            scope === "all" ? undefined : (
              <CommandPill label={PILL_LABEL[scope]} onClear={() => setScope("all")} />
            )
          }
        />
        <PaletteList>
          <PaletteEmpty>
            {scope === "links" && search.trim() === ""
              ? "Type part of a slug, title or address."
              : "Nothing matches."}
          </PaletteEmpty>
          {body}
        </PaletteList>
        <PaletteFooter />
      </CommandSheet>

      {dialogs}
    </>
  );
}
