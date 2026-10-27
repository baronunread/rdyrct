/**
 * The admin audit log (#67), on a tab of its own.
 *
 * It answers "who did this, and why" about the whole platform, not only about
 * links, so it does not belong inside the Links screen: bans, comps and org
 * deletions are recorded here too.
 */
import { useMemo, useState } from "react";
import { useAdminAudit } from "../../lib/hooks";
import { PageHeader, Table, Td, Th } from "../../ui/misc";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { AdminAuditRowsSkeleton } from "../../components/skeletons";
import { relativeDate } from "../../lib/dates";
import { SearchInput } from "./search-input";
import { FilterBar, FilterRow } from "./admin-kit";
import { paginate } from "./util";
import { Pager } from "../../ui/pagination";
import type { AdminActionRow, Sort } from "@/shared/types";

/** An entry matches if the term appears in what somebody would search by:
 * the action, who did it, or what it said. An empty term matches everything. */
function matchesTerm(
  entry: { action: string; actorEmail: string | null; detail: string | null },
  term: string,
): boolean {
  if (!term) return true;
  const haystack = [entry.action, entry.actorEmail ?? "", entry.detail ?? ""].join(" ");
  return haystack.toLowerCase().includes(term);
}

/** The kinds of action somebody looks for after an incident. Each matches
 * the action names the Worker records (src/worker/audit.ts). */
const KINDS = [
  { id: "all", label: "All", test: () => true },
  { id: "bans", label: "Bans", test: (a) => a === "user.ban" || a === "user.unban" },
  { id: "comps", label: "Comps", test: (a) => a.startsWith("user.comp_") },
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
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The address may be gone: the log outlives the account. "system" is the
 * sweep, which has no account to delete. */
function Actor({ entry }: { entry: { actorEmail: string | null; actorUserId: string } }) {
  if (entry.actorEmail)
    return (
      <span className="block truncate font-mono text-xs" title={entry.actorEmail}>
        {entry.actorEmail}
      </span>
    );
  return (
    <span className="text-muted">
      {entry.actorUserId === "system" ? "System" : "Deleted account"}
    </span>
  );
}

function AuditTable({
  rows,
  sort,
  onSort,
}: {
  rows: AdminActionRow[];
  sort: Sort;
  onSort: (s: Sort) => void;
}) {
  return (
    <Table fixed minWidth="min-w-[52rem]">
      <thead>
        <tr>
          <SortTh
            label="When"
            sortKey="createdAt"
            sort={sort}
            onSort={onSort}
            className="w-[19%]"
          />
          <SortTh
            label="Who"
            sortKey="actorEmail"
            sort={sort}
            onSort={onSort}
            className="w-[24%]"
          />
          <SortTh label="Action" sortKey="action" sort={sort} onSort={onSort} className="w-[19%]" />
          <Th>Detail</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <tr key={entry.id}>
            {/* Two lines: how long ago, which is what a person reads, over the
                exact time, which is what they quote. */}
            <Td>
              <span className="flex flex-col gap-0.5 leading-tight whitespace-nowrap">
                <span className="text-sm first-letter:uppercase">
                  {relativeDate(entry.createdAt)}
                </span>
                <span className="tnum text-xs text-muted">{WHEN.format(entry.createdAt)}</span>
              </span>
            </Td>
            <Td className="truncate">
              <Actor entry={entry} />
            </Td>
            <Td className="truncate font-mono text-xs">{entry.action}</Td>
            <Td
              className="truncate font-mono text-xs text-muted"
              title={entry.detail ?? entry.targetId}
            >
              {entry.detail ?? entry.targetId}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function AdminAuditPage() {
  const { data, isPending } = useAdminAudit();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);

  const counts = useMemo(
    () =>
      KINDS.map((k) => ({
        id: k.id,
        label: k.label,
        count: (data ?? []).filter((e) => k.test(e.action)).length,
      })),
    [data],
  );

  // Filtered here, not on the server: the endpoint is capped, so the rows
  // are already in hand.
  const term = query.trim().toLowerCase();
  const pass = kindTest(kind);
  const all = sortRows(
    (data ?? []).filter((entry) => pass(entry.action) && matchesTerm(entry, term)),
    sort,
    {
      createdAt: (e) => e.createdAt,
      actorEmail: (e) => e.actorEmail ?? "",
      action: (e) => e.action,
      detail: (e) => e.detail ?? e.targetId,
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);
  const filtered = !!term || kind !== "all";

  return (
    // The header spaces itself, as on every page; the gap is for what is under it.
    <div>
      <PageHeader
        title="Audit log"
        sub="Every privileged action, newest first. Entries are never edited or removed."
      />
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
            placeholder="Search action, email or detail"
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
          <AuditTable rows={rows} sort={sort} onSort={setSort} />
        )}

        <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
