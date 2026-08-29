import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
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

/** A one-token string with a dot in it: enough to read as "make this a link". */
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || (/\.[a-z]{2,}/i.test(s) && !/\s/.test(s));
}

type Query =
  | { kind: "create"; arg: string }
  | { kind: "search-links"; arg: string }
  | { kind: "plain"; arg: string };

/** `create link: <url>` and `search link: <text>` are explicit modes; a bare
 * URL also reads as create; everything else is a plain filter. */
function parseQuery(raw: string): Query {
  const create = raw.match(/^create link:\s*(.*)$/is);
  if (create) return { kind: "create", arg: create[1].trim() };
  const search = raw.match(/^search link:\s*(.*)$/is);
  if (search) return { kind: "search-links", arg: search[1].trim() };
  return { kind: "plain", arg: raw.trim() };
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

/** The current org's links matching `term`, capped at six. The query reaches
 * the server (the list is paged), so it lags a keystroke. */
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
 * offers to alias it or make a separate link (#38). Returns a `start(url)`
 * and the two dialogs to render.
 */
// fallow-ignore-next-line complexity
function useLinkCreateFlow(close: () => void) {
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
    close();
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

/** An explicit `create link:` prefix, or a bare URL, offers a create item. */
function wantsCreate(q: Query): boolean {
  return q.kind === "create" || (q.kind === "plain" && looksLikeUrl(q.arg));
}

/** Pages and actions show only in plain mode, filtered by the term. */
function actionsIn(actions: Action[], q: Query, group: Action["group"]): Action[] {
  if (q.kind !== "plain") return [];
  return actions.filter((a) => a.group === group && hit(`${a.label} ${a.value}`, q.arg));
}

/** What to feed the link search: nothing while composing a `create link:`. */
function linkTerm(q: Query): string {
  return q.kind === "create" ? "" : q.arg;
}

/**
 * ⌘K / Ctrl+K command palette. Mounted once in AppShell, so it rides on every
 * app route. It is the one discoverable home for the shortcuts the app
 * otherwise keeps quiet (type or paste anywhere on the dashboard, and
 * whatever lands here next).
 *
 * Typing filters pages and actions and searches the org's links. Prefix with
 * `search link:` to see links only, `create link:` (or just paste a URL) to
 * make one on the spot. The bare-keystroke listener on the dashboard ignores
 * anything with a modifier, so ⌘K never collides with it.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = () => setOpen(false);

  const parsed = parseQuery(search);
  const actions = useActions(close);
  const links = useLinkMatches(linkTerm(parsed), close);
  const { start: createLink, dialogs: createDialogs } = useLinkCreateFlow(close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleChord(e)) return;
      e.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Fresh each open: a stale term would show stale results for a frame.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} label="Command menu" shouldFilter={false}>
        <CommandInput
          placeholder="Search pages, links, actions… or paste a URL"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {wantsCreate(parsed) && <CreateGroup arg={parsed.arg} onRun={createLink} />}
          {links.length > 0 && <LinksGroup links={links} />}
          <ActionGroup heading="Go to" items={actionsIn(actions, parsed, "Go to")} />
          <ActionGroup heading="Actions" items={actionsIn(actions, parsed, "Actions")} />
        </CommandList>
      </CommandDialog>

      {createDialogs}
    </>
  );
}
