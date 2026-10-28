/**
 * The admin audit log (#67), on a tab of its own.
 *
 * It answers "who did this, and why" about the whole platform, not only about
 * links, so it does not belong inside the Links screen: bans, comps and org
 * deletions are recorded here too. A row says who, what and to whom; the rest
 * of the entry (the reason, the counts, the ids) opens from the row.
 */
import { settle } from "../../lib/route-preload";
import { useMemo, useRef, useState } from "react";
import * as v from "valibot";
import { ArrowRight } from "@/app/ui/icons";
import type { QueryClient } from "@tanstack/react-query";
import { adminAuditQuery, useAdminAudit } from "../../lib/hooks";
import {
  adminOrgsQuery,
  adminUsersQuery,
  useAdminOrgsData,
  useAdminUsersData,
} from "../../lib/admin-data";
import { Table, Td, Th } from "../../ui/misc";
import { Dialog } from "../../ui/dialog";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { AdminAuditRowsSkeleton } from "../../components/skeletons";
import { relativeDate } from "../../lib/dates";
import { SearchInput } from "./search-input";
import { FilterBar, FilterRow, PHONE, SectionHeading } from "./admin-kit";
import { paginate } from "./util";
import { Pager } from "../../ui/pagination";
import type { AdminActionRow, JsonValue, Sort } from "@/shared/types";
import { lookup } from "@/shared/lookup";

/** The kinds of action somebody looks for after an incident. Each matches
 * the action names the Worker records (src/worker/audit.ts). A plan change
 * an admin makes is a comp; `plan.` is there for the day the Worker logs
 * Polar's changes too. */
const KINDS = [
  { id: "all", label: "All", test: () => true },
  { id: "bans", label: "Bans", test: (a) => a === "user.ban" || a === "user.unban" },
  {
    id: "plans",
    label: "Plan changes",
    test: (a) => a.startsWith("user.comp_") || a.startsWith("plan."),
  },
  {
    id: "suspensions",
    label: "Suspensions",
    test: (a) => /^(link\.(un)?suspend|org\.(un)?suspend_links)$/.test(a),
  },
  { id: "deletions", label: "Deletions", test: (a) => a.endsWith(".delete") },
  { id: "hosts", label: "Blocked hosts", test: (a) => a.startsWith("host.") },
] as const satisfies readonly { id: string; label: string; test: (action: string) => boolean }[];
type Kind = (typeof KINDS)[number]["id"];

const kindTest = (id: Kind) => KINDS.find((k) => k.id === id)?.test ?? (() => true);

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WHEN_FULL = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "medium",
  hourCycle: "h23",
});

/** `detail` is the JSON the Worker wrote with the entry (recordAdminAction). */
const jsonValue: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(jsonValue),
    v.record(v.string(), jsonValue),
  ]),
);
const detailSchema = v.record(v.string(), jsonValue);
type Detail = v.InferOutput<typeof detailSchema>;

function parseDetail(raw: string | null): Detail {
  if (!raw) return {};
  try {
    const parsed = v.safeParse(detailSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : { detail: raw };
  } catch {
    // Not JSON: an entry from before the column held JSON. Shown as written.
    return { detail: raw };
  }
}

const text = (value: JsonValue | undefined): string | null =>
  value === undefined || value === null
    ? null
    : Array.isArray(value) || v.is(v.record(v.string(), jsonValue), value)
      ? JSON.stringify(value)
      : String(value);

/** An entry with the names the page could find for its ids. */
interface Entry extends AdminActionRow {
  who: string;
  target: string;
  fields: Detail;
}

/** Ids to names, from the users and orgs lists the other tabs load. A user
 * or org deleted since keeps what the entry itself recorded. */
function useNames() {
  const users = useAdminUsersData();
  const orgs = useAdminOrgsData();
  return useMemo(
    () => ({
      user: new Map((users.data ?? []).map((u) => [u.id, u])),
      org: new Map((orgs.data ?? []).map((o) => [o.id, o.name])),
    }),
    [users.data, orgs.data],
  );
}

type Names = ReturnType<typeof useNames>;

function who(entry: AdminActionRow, names: Names): string {
  if (entry.actorUserId === "system") return "System";
  return names.user.get(entry.actorUserId)?.name || entry.actorEmail || "Deleted account";
}

/** What the action was done to, in words: the link, the address, the org. */
function target(entry: AdminActionRow, fields: Detail, names: Names): string {
  const slug = text(fields.slug);
  const base = (() => {
    switch (entry.targetType) {
      case "link":
      case "anon_link":
        return slug ? `/${slug}` : entry.targetId;
      case "user":
        return names.user.get(entry.targetId)?.email ?? text(fields.email) ?? "Deleted account";
      case "org":
        return names.org.get(entry.targetId) ?? text(fields.name) ?? "Deleted organization";
      case "report":
        return slug ? `Report on /${slug}` : "A report";
      default:
        return entry.targetId;
    }
  })();
  const plan = text(fields.plan);
  return plan ? `${base} · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : base;
}

/** What happened, in words, for the entry's title. */
const ACTION_WORDS = {
  "link.suspend": "Link suspended",
  "link.unsuspend": "Link restored",
  "link.delete": "Link deleted",
  "link.rescore": "Destination checked again",
  "link.warn": "Warning shown",
  "link.unwarn": "Warning removed",
  "org.suspend_links": "Organization's links suspended",
  "org.unsuspend_links": "Organization's links restored",
  "org.delete": "Organization deleted",
  "org.reviewed": "Organization reviewed",
  "org.abuse": "Organization held for abuse",
  "host.block": "Host blocked",
  "host.unblock": "Host unblocked",
  "report.dismiss": "Report dismissed",
  "user.ban": "User banned",
  "user.unban": "User unbanned",
  "user.delete": "User deleted",
  "user.comp_grant": "Comp granted",
  "user.comp_revoke": "Comp revoked",
  "anon_link.delete": "Anonymous link deleted",
} as const;

/** Identifiers are set in mono (rdyrct-design, "The two type rules"). */
const MONO_FIELD = /(^id$|Id$|_id$|slug|destination|email|host|url)/i;

/** "orgsDeleted" reads "Orgs deleted". */
const fieldLabel = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

function EntryDialog({ entry: current, onClose }: { entry: Entry | null; onClose: () => void }) {
  // The last entry stays while the dialog fades out, so it does not empty.
  const last = useRef<Entry | null>(null);
  if (current) last.current = current;
  const entry = current ?? last.current;
  const facts: [string, string, boolean][] = entry
    ? [
        ["When", WHEN_FULL.format(entry.createdAt), false],
        ["Who", entry.actorEmail ? `${entry.who} · ${entry.actorEmail}` : entry.who, false],
        ["Action", entry.action, true],
        ["Target", entry.target, false],
        [`${fieldLabel(entry.targetType)} id`, entry.targetId, true],
        ...Object.entries(entry.fields).map(([key, value]): [string, string, boolean] => [
          fieldLabel(key),
          text(value) ?? "none",
          MONO_FIELD.test(key),
        ]),
        ["Entry id", entry.id, true],
      ]
    : [];
  return (
    <Dialog
      open={!!current}
      onOpenChange={(open) => !open && onClose()}
      title={entry ? (lookup(ACTION_WORDS, entry.action) ?? entry.action) : "Entry"}
    >
      <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
        {facts.map(([label, value, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className={mono ? "font-mono text-xs/5 break-all" : "break-words"}>{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function AuditTable({
  rows,
  sort,
  onSort,
  onOpen,
}: {
  rows: Entry[];
  sort: Sort;
  onSort: (s: Sort) => void;
  onOpen: (entry: Entry) => void;
}) {
  return (
    <Table fixed minWidth={`sm:min-w-[44rem] ${PHONE.table}`}>
      <thead className={PHONE.head}>
        <tr>
          <SortTh
            label="When"
            sortKey="createdAt"
            sort={sort}
            onSort={onSort}
            className="w-[19%]"
          />
          <SortTh label="Who" sortKey="who" sort={sort} onSort={onSort} className="w-[20%]" />
          <SortTh label="Action" sortKey="action" sort={sort} onSort={onSort} className="w-[19%]" />
          <SortTh label="Target" sortKey="target" sort={sort} onSort={onSort} />
          <Th className="w-12 px-2">
            <span className="sr-only">Details</span>
          </Th>
        </tr>
      </thead>
      <tbody className={PHONE.body}>
        {rows.map((entry) => (
          // The whole row opens the entry for a pointer; the arrow button is
          // the same thing for a keyboard and a screen reader.
          <tr
            key={entry.id}
            onClick={() => onOpen(entry)}
            className={`cursor-pointer ${PHONE.row}`}
          >
            {/* Two lines: how long ago, which is what a person reads, over the
                exact time, which is what they quote. */}
            <Td className={PHONE.main}>
              <span className="flex flex-col gap-0.5 leading-tight whitespace-nowrap">
                <span className="text-sm first-letter:uppercase">
                  {relativeDate(entry.createdAt)}
                </span>
                <span className="tnum text-xs text-muted">{WHEN.format(entry.createdAt)}</span>
              </span>
            </Td>
            <Td
              className={`truncate ${PHONE.meta} max-sm:before:content-none`}
              title={entry.actorEmail ?? undefined}
            >
              {entry.who}
            </Td>
            <Td className={`truncate font-mono text-xs ${PHONE.meta}`}>{entry.action}</Td>
            <Td
              className="truncate text-sm text-muted max-sm:order-3 max-sm:w-full max-sm:border-0 max-sm:p-0"
              title={entry.target}
            >
              {entry.target}
            </Td>
            <Td className={`px-2 text-right ${PHONE.menu}`}>
              <button
                type="button"
                aria-label={`Open entry: ${entry.action}, ${entry.target}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(entry);
                }}
                className="grid size-8 cursor-pointer place-items-center rounded-md text-placeholder transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.96] [@media(hover:hover)]:group-hover/row:text-text"
              >
                <ArrowRight size={14} />
              </button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** An entry matches if the term appears in what somebody would search by:
 * who, the action, what it was done to, or what it recorded. */
function matchesTerm(entry: Entry, term: string): boolean {
  if (!term) return true;
  const haystack = [
    entry.who,
    entry.actorEmail ?? "",
    entry.action,
    entry.target,
    entry.detail ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

/** The audit log's first frame (see lib/route-preload.ts): the entries, and
 * the users and orgs that name their ids. */
export const preload = (qc: QueryClient) =>
  settle([
    qc.ensureQueryData(adminAuditQuery),
    qc.ensureQueryData(adminUsersQuery),
    qc.ensureQueryData(adminOrgsQuery),
  ]);

export function AdminAuditPage() {
  const { data, isPending } = useAdminAudit();
  const names = useNames();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Entry | null>(null);

  const entries = useMemo<Entry[]>(
    () =>
      (data ?? []).map((row) => {
        const fields = parseDetail(row.detail);
        return { ...row, fields, who: who(row, names), target: target(row, fields, names) };
      }),
    [data, names],
  );

  const counts = useMemo(
    () =>
      KINDS.map((k) => ({
        id: k.id,
        label: k.label,
        count: entries.filter((e) => k.test(e.action)).length,
      })),
    [entries],
  );

  // Filtered here, not on the server: the endpoint is capped, so the rows
  // are already in hand.
  const term = query.trim().toLowerCase();
  const pass = kindTest(kind);
  const all = sortRows(
    entries.filter((entry) => pass(entry.action) && matchesTerm(entry, term)),
    sort,
    {
      createdAt: (e) => e.createdAt,
      who: (e) => e.who.toLowerCase(),
      action: (e) => e.action,
      target: (e) => e.target.toLowerCase(),
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);
  const filtered = !!term || kind !== "all";

  return (
    <div>
      <SectionHeading>Audit log</SectionHeading>
      <div className="flex flex-col gap-4">
        <FilterBar>
          <FilterRow
            label="Filter the audit log"
            items={counts}
            value={kind}
            onChange={(next) => {
              setKind(next);
              setPage(0);
            }}
          />
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder="Search actor or target"
            label="Search the audit log"
          />
        </FilterBar>

        {isPending ? (
          <AdminAuditRowsSkeleton />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {filtered ? "Nothing recorded matches that." : "Nothing recorded yet."}
          </p>
        ) : (
          <AuditTable rows={rows} sort={sort} onSort={setSort} onOpen={setOpen} />
        )}

        <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />
        <p className="text-xs text-muted">Entries are never edited or removed.</p>
      </div>
      <EntryDialog entry={open} onClose={() => setOpen(null)} />
    </div>
  );
}
