/**
 * The admin audit log (#67), on a tab of its own.
 *
 * It answers "who did this, and why" about the whole platform, not only about
 * links, so it does not belong inside the Links screen: bans, comps and org
 * deletions are recorded here too.
 */
import { useState } from "react";
import { useAdminAudit } from "../../lib/hooks";
import { PageHeader, Table, Td, Th } from "../../ui/misc";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { AdminTableSkeleton } from "../../components/skeletons";
import { shortDate } from "../../lib/dates";
import { SearchInput } from "./search-input";
import { paginate } from "./util";
import { Pager } from "../../ui/pagination";
import type { Sort } from "@/shared/types";

export function AdminAuditPage() {
  const { data, isPending } = useAdminAudit();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);

  // Filtered here, not on the server: the endpoint is capped, so the rows
  // are already in hand.
  const term = query.trim().toLowerCase();
  const all = sortRows(
    (data ?? []).filter(
      (entry) =>
        !term ||
        entry.action.toLowerCase().includes(term) ||
        (entry.actorEmail ?? "").toLowerCase().includes(term) ||
        (entry.detail ?? "").toLowerCase().includes(term),
    ),
    sort,
    {
      createdAt: (e) => e.createdAt,
      actorEmail: (e) => e.actorEmail ?? "",
      action: (e) => e.action,
      detail: (e) => e.detail ?? e.targetId,
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Audit log"
        sub="Every privileged action, newest first. Append-only: entries are never edited or removed."
      />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Action, email, or detail"
        label="Search the audit log"
      />

      {isPending ? (
        <AdminTableSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <Table fixed>
          <thead>
            <tr>
              <SortTh
                label="When"
                sortKey="createdAt"
                sort={sort}
                onSort={setSort}
                className="w-[30%] sm:w-[16%]"
              />
              <SortTh
                label="Who"
                sortKey="actorEmail"
                sort={sort}
                onSort={setSort}
                className="hidden sm:table-cell sm:w-[22%]"
              />
              <SortTh
                label="Action"
                sortKey="action"
                sort={sort}
                onSort={setSort}
                className="w-[70%] sm:w-[18%]"
              />
              <Th className="hidden sm:table-cell sm:w-[44%]">Detail</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <Td className="whitespace-nowrap text-muted">{shortDate(entry.createdAt)}</Td>
                {/* The address may be gone: the log outlives the account. */}
                <Td className="hidden truncate sm:table-cell">
                  {entry.actorEmail ?? <span className="text-muted">deleted account</span>}
                </Td>
                <Td className="truncate font-mono text-xs">{entry.action}</Td>
                <Td
                  className="hidden truncate text-muted sm:table-cell"
                  title={entry.detail ?? entry.targetId}
                >
                  {entry.detail ?? entry.targetId}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
