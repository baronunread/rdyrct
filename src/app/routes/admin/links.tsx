/**
 * Cross-org link moderation (#67).
 *
 * The screen somebody opens with an abuse report in front of them. It is
 * built around that: one search box that takes either a slug or a destination,
 * because those are the two things a report contains, and one action that
 * stops a link without touching anything else the organization owns.
 *
 * Anonymous links (#96) are listed here too rather than in a tab of their
 * own. A report naming a slug does not know which table it came from, and
 * two places to search is one place too many at 2am.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Ellipsis,
  ExternalLink,
  ShieldQuestionMark,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "@/app/ui/icons";
import { useAdminAnonLinks, useAdminLinks, useAdminReports } from "../../lib/hooks";
import { api } from "../../lib/api";
import { linkDisplayTitle } from "../../lib/link-display";
import type { AdminAnonLinkRow, AdminLinkRow, AdminReportRow, Sort } from "@/shared/types";
import { Badge, PageHeader, Table, Td, Th } from "../../ui/misc";
import { Button } from "../../ui/button";
import { Field, Input, Select } from "../../ui/field";
import { Dialog } from "../../ui/dialog";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Menu, MenuItem, MenuNote, MenuSeparator } from "../../ui/menu";
import { TableSkeleton } from "../../ui/skeleton";
import { useToast } from "../../ui/toast";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { SearchInput } from "./search-input";
import { paginate } from "./util";
import { Pager } from "../../ui/pagination";
import { useDebounced } from "../../lib/use-debounced";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { useSearchParams, HrefLink } from "../../lib/router-search";
import { Segmented } from "../../ui/segmented";
import { BlockedHosts } from "./blocked-hosts";
import { linkStateDetail, linkStateRank } from "./link-state";
import { LinkStateBadge } from "./link-state-badge";
import { Spinner } from "../../ui/spinner";

/** The two columns both tables open with. Destination has no width of its
 * own: every other column is sized, so it takes what is left, which is the
 * most room on the screen for the longest value in the row. */
function SlugAndDestinationHeaders({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  return (
    <>
      <SortTh label="Link" sortKey="slug" sort={sort} onSort={onSort} className="w-[16%]" />
      <SortTh label="Destination" sortKey="destination" sort={sort} onSort={onSort} />
    </>
  );
}

/** Column widths both link tables share. The short columns are fixed, so a
 * badge or a date never takes room the destination needs. */
const COL = {
  check: "w-11 pr-0",
  org: "w-[17%]",
  // pr-2/pl-2: the longest badge ("suspended") and the "Reports" header fit
  // without another 16px of padding each.
  state: "w-28 pr-2",
  reports: "w-[5.25rem] pl-2 text-right",
  clicks: "w-[4.5rem] pl-2 text-right",
  date: "w-28",
  actions: "w-12 px-2",
} as const;

/** The id a mutation is currently working on, for the row that should show
 * itself as busy. */
function pendingId(mutation: { isPending: boolean; variables?: string }): string | null {
  return mutation.isPending ? (mutation.variables ?? null) : null;
}

/** The same, for a mutation that takes the whole row. */
function pendingLinkId(mutation: { isPending: boolean; variables?: AdminLinkRow }) {
  return pendingId({ isPending: mutation.isPending, variables: mutation.variables?.id });
}

/** What a row can be told to do. One type because the row, its menu, and the
 * table all pass the same five things down. */
type RowActions = {
  selected: boolean;
  onSelect: (l: AdminLinkRow) => void;
  onSuspend: (l: AdminLinkRow) => void;
  onRestore: (l: AdminLinkRow) => void;
  onDelete: (l: AdminLinkRow) => void;
  onRescore: (l: AdminLinkRow) => void;
  rescoring: boolean;
  onWarn: (l: AdminLinkRow) => void;
  warning: boolean;
};

/** The actions menu both tables hang off a row: same trigger, same first
 * item, different endings. */
function RowMenu({
  slug,
  destination,
  note,
  children,
}: {
  slug: string;
  destination: string;
  /** The row state in words, for a touch screen that cannot hover the badge. */
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Menu
      align="end"
      label={`Actions for ${slug}`}
      trigger={
        <div className="flex justify-end">
          <span className="rounded p-1.5 text-muted transition-transform duration-150 active:scale-[0.96] hover:bg-surface-2 hover:text-text">
            <Ellipsis size={15} />
          </span>
        </div>
      }
    >
      <MenuNote>
        {/* One fact a line: the tooltip joins them with " · ", which wraps
            badly in a menu this narrow. */}
        {note.split(" · ").map((fact) => (
          <span key={fact} className="block">
            {fact}
          </span>
        ))}
      </MenuNote>
      <MenuSeparator />
      <MenuItem onClick={() => window.open(destination, "_blank", "noopener,noreferrer")}>
        <ExternalLink size={14} /> Open destination
      </MenuItem>
      {children}
    </Menu>
  );
}

/** A search term and the page it resets. Typing narrows the results, so
 * paginate() would otherwise clamp you to the last page of a smaller set and
 * leave you wondering where everything went. */
function useTableSearch() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = (value: string) => {
    setQuery(value);
    setPage(0);
  };
  return { query, search, page, setPage };
}

/** The delete confirmation both tables raise. The consequence differs, so it
 * is the caller's to write. */
function DeleteLinkDialog({
  link,
  pending,
  onClose,
  onConfirm,
  children,
}: {
  link: { id: string; slug: string } | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <ConfirmDialog
      title="Delete this link?"
      open={!!link}
      onClose={onClose}
      onConfirm={() => link && onConfirm(link.id)}
      confirmLabel="Delete link"
      danger
      pending={pending}
    >
      <p className="text-sm text-muted">
        <span className="font-mono font-bold text-text">/{link?.slug}</span> {children}
      </p>
    </ConfirmDialog>
  );
}

function SuspendDialog({ link, onClose }: { link: AdminLinkRow | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const suspend = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api(`/admin/links/${input.id}`, {
        method: "PATCH",
        body: { suspended: true, reason: input.reason },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "links"] });
      await qc.invalidateQueries({ queryKey: ["admin", "audit"] });
      toast("Link suspended. It stops redirecting immediately.");
      setReason("");
      onClose();
    },
    onError: withErrorToast(toast),
  });

  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()} title="Suspend this link">
      {link && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface-2 p-3 text-xs">
            <p className="font-mono font-bold">{linkDisplayTitle(link.url)}</p>
            <p className="mt-1 break-all text-muted">{link.destination}</p>
          </div>
          <p className="text-xs text-muted">
            The redirect stops at once and stays stopped, including after the owner edits the link.
            Nothing is deleted: the link and its clicks survive, and you can restore it.
          </p>
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Phishing report, ticket 412"
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || suspend.isPending}
              onClick={() => suspend.mutate({ id: link.id, reason: reason.trim() })}
            >
              Suspend link
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Put a warning page in front of a link, or take it off (#344). A suspended
 * link serves nothing, so there is nothing to warn about. */
function WarnMenuItem({
  link,
  warning,
  onWarn,
}: {
  link: AdminLinkRow;
  warning: boolean;
  onWarn: (l: AdminLinkRow) => void;
}) {
  if (link.suspendedAt) return null;
  return (
    <MenuItem disabled={warning} onClick={() => onWarn(link)}>
      {warning ? <Spinner /> : <TriangleAlert size={14} />}{" "}
      {link.warnedAt ? "Remove warning" : "Show a warning"}
    </MenuItem>
  );
}

/** Open reports, as a count like Clicks. A dash rather than 0, so the rows
 * that have any stand out down the column. */
function ReportsCell({ count }: { count: number }) {
  if (count === 0)
    return (
      <Td className="pl-2 text-right text-muted">
        <span aria-label="No reports">–</span>
      </Td>
    );
  return <Td className="pl-2 text-right tnum">{count}</Td>;
}

function LinkRow({ link, ...actions }: { link: AdminLinkRow } & RowActions) {
  return (
    <tr className={link.suspendedAt ? "opacity-60" : undefined}>
      <Td className="pr-0">
        <input
          type="checkbox"
          aria-label={`Select ${link.slug}`}
          checked={actions.selected}
          onChange={() => actions.onSelect(link)}
          className="size-4 cursor-pointer accent-accent"
        />
      </Td>
      {/* The slug only. Its state and why live in the State column's
          tooltip and the row menu, so every row stays one line. */}
      <Td className="truncate font-mono text-xs font-bold" title={linkDisplayTitle(link.url)}>
        {linkDisplayTitle(link.url)}
      </Td>
      <Td className="truncate font-mono text-xs text-muted" title={link.destination}>
        {link.destination}
      </Td>
      <Td className="truncate">
        {/* Straight to that organization's links, which is the next question
            after "who owns this". */}
        <HrefLink
          href={`/admin/links?org=${encodeURIComponent(link.orgId)}`}
          className="block truncate hover:text-accent hover:underline"
          title={link.orgName}
        >
          {link.orgName}
        </HrefLink>
      </Td>
      <Td className="pr-2">
        <LinkStateBadge link={link} />
      </Td>
      <ReportsCell count={link.reportCount} />
      <Td className="pl-2 text-right tnum">{link.clicks}</Td>
      <Td className="whitespace-nowrap text-muted">{shortDate(link.createdAt)}</Td>
      <Td className="px-2">
        <LinkActions link={link} {...actions} />
      </Td>
    </tr>
  );
}

/**
 * Suspend, restore, delete. A menu rather than a row of buttons, matching
 * every other table here, and because a destructive action sitting in the
 * open next to a date is one mis-click from an outage.
 */
function LinkActions({
  link,
  onSuspend,
  onRestore,
  onDelete,
  onRescore,
  rescoring,
  onWarn,
  warning,
}: { link: AdminLinkRow } & Omit<RowActions, "selected" | "onSelect">) {
  return (
    <RowMenu slug={link.slug} destination={link.destination} note={linkStateDetail(link)}>
      <MenuItem disabled={rescoring} onClick={() => onRescore(link)}>
        {rescoring ? <Spinner /> : <ShieldQuestionMark size={14} />} Re-check destination
      </MenuItem>
      <WarnMenuItem link={link} warning={warning} onWarn={onWarn} />
      <MenuSeparator />
      {link.suspendedAt ? (
        <MenuItem onClick={() => onRestore(link)}>
          <Undo2 size={14} /> Restore link
        </MenuItem>
      ) : (
        <MenuItem className="text-danger" onClick={() => onSuspend(link)}>
          <Ban size={14} /> Suspend link
        </MenuItem>
      )}
      <MenuItem className="text-danger" onClick={() => onDelete(link)}>
        <Trash2 size={14} /> Delete link
      </MenuItem>
    </RowMenu>
  );
}

function LinksTable({
  rows,
  isPending,
  sort,
  onSort,
  onSuspend,
  onRestore,
  onDelete,
  onRescore,
  rescoringId,
  onWarn,
  warningId,
  selectedIds,
  onSelect,
  onSelectAll,
}: {
  selectedIds: Set<string>;
  onSelect: (l: AdminLinkRow) => void;
  onSelectAll: (checked: boolean) => void;
  rows: AdminLinkRow[];
  isPending: boolean;
  sort: Sort;
  onSort: (s: Sort) => void;
  onSuspend: (l: AdminLinkRow) => void;
  onRestore: (l: AdminLinkRow) => void;
  onDelete: (l: AdminLinkRow) => void;
  onRescore: (l: AdminLinkRow) => void;
  rescoringId: string | null;
  onWarn: (l: AdminLinkRow) => void;
  warningId: string | null;
}) {
  // Rows only: this sits below the real header and the real search box,
  // and the page-level skeleton would draw a second one of each.
  if (isPending) return <TableSkeleton rows={6} testId="admin-links-rows-skeleton" />;
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted">No links match that search.</p>;

  return (
    // Fixed layout. In an auto-layout table a long destination sets the
    // column width and pushes everything past the card, and `max-w` on the
    // cell is ignored. The minimum fits the admin column on a laptop, so the
    // actions menu is on screen there; narrower than that, the card scrolls.
    <Table fixed minWidth="min-w-[58rem]">
      <thead>
        <tr>
          <Th className={COL.check}>
            <input
              type="checkbox"
              aria-label="Select all links on this page"
              checked={rows.length > 0 && rows.every((l) => selectedIds.has(l.id))}
              onChange={(e) => onSelectAll(e.target.checked)}
              className="size-4 cursor-pointer accent-accent"
            />
          </Th>
          <SlugAndDestinationHeaders sort={sort} onSort={onSort} />
          <SortTh
            label="Organization"
            sortKey="orgName"
            sort={sort}
            onSort={onSort}
            className={COL.org}
          />
          <SortTh label="State" sortKey="state" sort={sort} onSort={onSort} className={COL.state} />
          <SortTh
            label="Reports"
            sortKey="reportCount"
            sort={sort}
            onSort={onSort}
            className={COL.reports}
          />
          <SortTh
            label="Clicks"
            sortKey="clicks"
            sort={sort}
            onSort={onSort}
            className={COL.clicks}
          />
          <SortTh
            label="Created"
            sortKey="createdAt"
            sort={sort}
            onSort={onSort}
            className={COL.date}
          />
          <Th className={COL.actions} />
        </tr>
      </thead>
      <tbody>
        {rows.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            onSuspend={onSuspend}
            onRestore={onRestore}
            onDelete={onDelete}
            onRescore={onRescore}
            rescoring={rescoringId === link.id}
            onWarn={onWarn}
            warning={warningId === link.id}
            selected={selectedIds.has(link.id)}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </Table>
  );
}

/** Links made on the landing page with no account. No org, no owner, and
 * they expire on their own, so deleting is the only action worth having. */
/** The anonymous list itself. The owned table's columns in the same order,
 * so moving between the two tabs does not mean re-reading the header row.
 * An anonymous link has no organization and records no clicks; those cells
 * say so rather than being left out. Reports are not kept per anonymous link,
 * so that column is the one left out. */
function AnonymousLinksTable({
  rows,
  isPending,
  sort,
  onSort,
  onDelete,
}: {
  rows: AdminAnonLinkRow[];
  isPending: boolean;
  sort: Sort;
  onSort: (s: Sort) => void;
  onDelete: (l: AdminAnonLinkRow) => void;
}) {
  // Rows only: this sits below the real header and the real search box,
  // and the page-level skeleton would draw a second one of each.
  if (isPending) return <TableSkeleton rows={6} testId="admin-links-rows-skeleton" />;
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted">Nothing here.</p>;
  return (
    <Table fixed minWidth="min-w-[58rem]">
      <thead>
        <tr>
          <SlugAndDestinationHeaders sort={sort} onSort={onSort} />
          {/* Always "none" here, so it gets a short column, not the owned
              table's wide one. */}
          <Th className="w-28">Organization</Th>
          <SortTh label="State" sortKey="state" sort={sort} onSort={onSort} className={COL.state} />
          <Th className={COL.clicks}>Clicks</Th>
          <SortTh
            label="Created"
            sortKey="createdAt"
            sort={sort}
            onSort={onSort}
            className={COL.date}
          />
          <SortTh
            label="Expires"
            sortKey="expiresAt"
            sort={sort}
            onSort={onSort}
            className={COL.date}
          />
          <Th className={COL.actions} />
        </tr>
      </thead>
      <tbody>
        {rows.map((link) => (
          <tr key={link.id}>
            <Td className="truncate font-mono text-xs font-bold">/{link.slug}</Td>
            <Td className="truncate font-mono text-xs text-muted" title={link.destination}>
              {link.destination}
            </Td>
            {/* Nobody owns it, and no click is recorded against it: both
                    are the product boundary, not missing data. */}
            <Td className="text-muted">none</Td>
            <Td className="pr-2">
              <LinkStateBadge link={link} />
            </Td>
            <Td className="pl-2 text-right text-muted" title="Anonymous links record no clicks">
              none
            </Td>
            <Td className="whitespace-nowrap text-muted">{shortDate(link.createdAt)}</Td>
            <Td className="whitespace-nowrap text-muted">{shortDate(link.expiresAt)}</Td>
            <Td className="px-2">
              <RowMenu slug={link.slug} destination={link.destination} note={linkStateDetail(link)}>
                <MenuSeparator />
                <MenuItem className="text-danger" onClick={() => onDelete(link)}>
                  <Trash2 size={14} /> Delete link
                </MenuItem>
              </RowMenu>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AnonymousLinks() {
  const { data, isPending } = useAdminAnonLinks();
  const { query, search, page, setPage } = useTableSearch();
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [deleting, setDeleting] = useState<AdminAnonLinkRow | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/links/anonymous/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "anon-links"] });
      toast("Anonymous link deleted.");
      setDeleting(null);
    },
    onError: withErrorToast(toast),
  });

  // Filtered here rather than on the server: the whole table is at most a
  // day of anonymous links, so it is already small enough to hold.
  const term = query.trim().toLowerCase();
  const all = sortRows(
    (data ?? []).filter(
      (link) =>
        !term ||
        link.slug.toLowerCase().includes(term) ||
        link.destination.toLowerCase().includes(term),
    ),
    sort,
    {
      slug: (l) => l.slug,
      destination: (l) => l.destination,
      state: linkStateRank,
      expiresAt: (l) => l.expiresAt,
      createdAt: (l) => l.createdAt,
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={search}
          placeholder="Slug or destination"
          label="Search anonymous links"
        />
      </div>
      <AnonymousLinksTable
        rows={rows}
        isPending={isPending}
        sort={sort}
        onSort={setSort}
        onDelete={setDeleting}
      />
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <DeleteLinkDialog
        link={deleting}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={remove.mutate}
      >
        stops redirecting at once. It would have expired on its own within 24 hours.
      </DeleteLinkDialog>
    </div>
  );
}

/** The org a report landed on, or the fact that the address matched no link. */
function ReportOrg({ report: r }: { report: AdminReportRow }) {
  if (!r.orgId)
    return (
      <span className="text-muted" title="The address matched no link">
        no match
      </span>
    );
  return (
    <HrefLink
      href={`/admin/links?org=${encodeURIComponent(r.orgId)}`}
      className="block truncate hover:text-accent hover:underline"
      title={r.orgName ?? undefined}
    >
      {r.orgName}
    </HrefLink>
  );
}

function ReportRow({
  report: r,
  pending,
  onDismiss,
}: {
  report: AdminReportRow;
  pending: boolean;
  onDismiss: (id: string) => void;
}) {
  return (
    <tr>
      <Td className="truncate font-mono text-xs font-bold">/{r.slug}</Td>
      <Td className="truncate">
        <ReportOrg report={r} />
      </Td>
      <Td>
        <Badge color={r.reason === "other" ? "muted" : "pink"}>{r.reason}</Badge>
      </Td>
      <Td className="truncate text-muted" title={r.note}>
        {r.note || "none"}
      </Td>
      <Td className="truncate text-muted" title={r.contact}>
        {r.contact || "none"}
      </Td>
      <Td className="whitespace-nowrap text-muted">{shortDate(r.createdAt)}</Td>
      <Td className="px-2 text-right">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDismiss(r.id)}>
          Dismiss
        </Button>
      </Td>
    </tr>
  );
}

/** Open public reports. Newest first, with the way to the reported org's
 * links and a way to close one that needs nothing. */
function Reports() {
  const { data, isPending } = useAdminReports();
  const toast = useToast();
  const qc = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/admin/links/reports/${id}/dismiss`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      await qc.invalidateQueries({ queryKey: ["admin", "links"] });
      toast("Report dismissed.");
    },
    onError: withErrorToast(toast),
  });
  if (isPending) return <TableSkeleton rows={4} testId="admin-reports-rows-skeleton" />;
  const rows: AdminReportRow[] = data ?? [];
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted">No open reports.</p>;
  return (
    <Table fixed minWidth="min-w-[56rem]">
      <thead>
        <tr>
          {/* Note has no width: it is the free text, so it takes what the
              sized columns leave. The last column fits the Dismiss button,
              which a 6% column clipped behind the card's edge. */}
          <Th className="w-[14%]">Link</Th>
          <Th className={COL.org}>Organization</Th>
          <Th className="w-28">Reason</Th>
          <Th>Note</Th>
          <Th className="w-[16%]">Contact</Th>
          <Th className={COL.date}>When</Th>
          <Th className="w-24 px-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <ReportRow key={r.id} report={r} pending={dismiss.isPending} onDismiss={dismiss.mutate} />
        ))}
      </tbody>
    </Table>
  );
}

const VIEWS = [
  { id: "links", label: "Owned links" },
  { id: "reports", label: "Reports" },
  { id: "blocked", label: "Blocked hosts" },
  { id: "anonymous", label: "Anonymous" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/**
 * Restore, delete and re-check, with the toasts they answer with.
 *
 * Out of the component because three mutations, their success messages and
 * the cache they all invalidate are one subject, and inline they were most
 * of what OwnedLinks appeared to be about.
 */
function useOwnedLinkActions(onRestored: () => void, onDeleted: () => void) {
  const toast = useToast();
  const qc = useQueryClient();

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "links"] });
    await qc.invalidateQueries({ queryKey: ["admin", "audit"] });
  };

  const restore = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/links/${id}`, { method: "PATCH", body: { suspended: false } }),
    onSuccess: async () => {
      await refresh();
      toast("Link restored.");
      onRestored();
    },
    onError: withErrorToast(toast),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/links/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      toast("Link deleted.");
      onDeleted();
    },
    onError: withErrorToast(toast),
  });

  const restoreMany = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ count: number }>("/admin/links/restore", { method: "POST", body: { ids } }),
    onSuccess: async ({ count }) => {
      await refresh();
      toast(`${count} ${count === 1 ? "link" : "links"} restored.`);
    },
    onError: withErrorToast(toast),
  });

  /** No confirmation: it reads a destination and writes a score, and the
   * worst it can do is tell you something you did not want to hear. */
  const rescore = useMutation({
    mutationFn: (id: string) =>
      api<{ scored: boolean; score: number | null }>(`/admin/links/${id}/rescore`, {
        method: "POST",
      }),
    onSuccess: async (result) => {
      await refresh();
      toast(...rescoreResult(result));
    },
    onError: withErrorToast(toast),
  });

  /** One click either way, no confirmation: the link keeps working. */
  const warn = useMutation({
    mutationFn: (link: AdminLinkRow) =>
      api<{ warned: boolean }>(`/admin/links/${link.id}/warning`, {
        method: "PATCH",
        body: { warned: !link.warnedAt },
      }),
    onSuccess: async ({ warned }) => {
      await refresh();
      toast(
        warned
          ? "Warning on. Visitors see where the link goes before they continue."
          : "Warning removed. The link redirects straight away.",
      );
    },
    onError: withErrorToast(toast),
  });

  return { restore, restoreMany, remove, rescore, warn };
}

/** What a re-check has to say. "Unscored" is reported as such, never as
 * clean: the provider was unreachable or said something we do not
 * recognise (#68). */
function rescoreResult(result: { scored: boolean; score: number | null }): [string, "error"?] {
  if (!result.scored) return ["No answer from the checker. The link is still unscored.", "error"];
  if (result.score && result.score >= 100) return ["Checked: the destination is blocked."];
  return ["Checked: nothing known against the destination."];
}

/** Undoes a suspension, which is the whole point of suspending rather than
 * deleting. */
function RestoreLinkDialog({
  link,
  pending,
  onClose,
  onConfirm,
}: {
  link: AdminLinkRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <ConfirmDialog
      title="Restore this link?"
      open={!!link}
      onClose={onClose}
      onConfirm={() => link && onConfirm(link.id)}
      confirmLabel="Restore link"
      pending={pending}
    >
      <p className="text-sm text-muted">
        <span className="font-mono font-bold text-text">/{link?.slug}</span> starts redirecting
        again immediately.
      </p>
    </ConfirmDialog>
  );
}

/** Shown while the list is scoped to one organization, which is where a
 * click on an owner's name lands you. */
function ClearOrgFilterButton({ orgName, onClear }: { orgName?: string; onClear: () => void }) {
  const label = `Clear filter: ${orgName ?? "one organization"}`;
  return (
    // Names the organization once, as the chip, so the row says what it is
    // narrowed to. The same height as the search box and the select beside it.
    <Button
      variant="outline"
      onClick={onClear}
      aria-label={label}
      title={label}
      className="max-w-60"
    >
      <span className="truncate">{orgName ?? "Organization"}</span>
      <X size={14} className="shrink-0 text-muted" />
    </Button>
  );
}

/** The search box, plus the "you are looking at one organization" escape
 * hatch that a click on an owner's name puts you behind. */
const STATUSES = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "warned", label: "Warning" },
] as const;
type Status = (typeof STATUSES)[number]["id"];

function OwnedLinksToolbar({
  query,
  onSearch,
  status,
  onStatus,
  orgFilter,
  orgName,
  onClearOrg,
  children,
}: {
  children?: React.ReactNode;
  query: string;
  onSearch: (value: string) => void;
  status: Status;
  onStatus: (value: Status) => void;
  orgFilter: string;
  orgName?: string;
  onClearOrg: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={query}
        onChange={onSearch}
        placeholder="Slug or destination"
        label="Search links"
      />
      <Select
        aria-label="Filter by status"
        wrapperClass="w-36"
        value={status}
        onChange={(e) => onStatus(STATUSES.find((s) => s.id === e.target.value)?.id ?? "all")}
      >
        {STATUSES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
      {orgFilter && <ClearOrgFilterButton orgName={orgName} onClear={onClearOrg} />}
      {children}
    </div>
  );
}

/** The column sort. State sorts worst first (linkStateRank), and unscored
 * ranks below clean: nobody has looked at it, which is not the same as clean. */
function sortOwnedLinks(data: AdminLinkRow[] | undefined, sort: Sort) {
  // No org filter here: the query applies it, so its 200-row cap counts that
  // organization's links rather than every organization's.
  return sortRows(data ?? [], sort, {
    slug: (l) => l.slug,
    destination: (l) => l.destination,
    orgName: (l) => l.orgName,
    state: linkStateRank,
    reportCount: (l) => l.reportCount,
    clicks: (l) => l.clicks,
    createdAt: (l) => l.createdAt,
  });
}

/** Which rows are ticked. A set of ids, so a tick survives the sort or page
 * changing under it. */
function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  return {
    ids,
    has: (id: string) => ids.has(id),
    clear: () => setIds(new Set()),
    toggle: (id: string, on: boolean) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
  };
}

/** Appears once something restorable is ticked. */
function RestoreSelectedBar({
  count,
  pending,
  onClear,
  onRestore,
}: {
  count: number;
  pending: boolean;
  onClear: () => void;
  onRestore: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="ml-auto flex items-center gap-2 text-sm">
      <span className="text-muted">
        <span className="font-bold tnum text-text">{count}</span> suspended selected
      </span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
      <Button size="sm" disabled={pending} onClick={onRestore}>
        {pending && <Spinner />} Restore selected
      </Button>
    </div>
  );
}

/** The cross-org list with its own controls. Split out so the page itself is
 * just the switch and the two things it switches between. */
function OwnedLinks({ onSuspend }: { onSuspend: (l: AdminLinkRow) => void }) {
  const [params, setParams] = useSearchParams();
  const orgFilter = params.get("org") ?? "";
  const { query, search: onSearch, page, setPage } = useTableSearch();
  // The term reaches the server, so it waits for a pause in typing. Without
  // this, "testing" was eight requests.
  const search = useDebounced(query);
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [restoring, setRestoring] = useState<AdminLinkRow | null>(null);
  const [deleting, setDeleting] = useState<AdminLinkRow | null>(null);
  const [status, setStatus] = useState<Status>("all");
  const selection = useSelection();
  const { data, isPending } = useAdminLinks({ q: search, status, org: orgFilter });
  const { restore, restoreMany, remove, rescore, warn } = useOwnedLinkActions(
    () => setRestoring(null),
    () => setDeleting(null),
  );

  const all = sortOwnedLinks(data, sort);
  const { rows, totalPages, safePage } = paginate(all, page);
  // Only suspended links can be restored; selecting an active one is harmless
  // but must not be counted or sent.
  const restorable = all.filter((l) => selection.has(l.id) && l.suspendedAt).map((l) => l.id);

  return (
    <div className="flex flex-col gap-3">
      <OwnedLinksToolbar
        query={query}
        onSearch={onSearch}
        status={status}
        onStatus={(next) => {
          setStatus(next);
          setPage(0);
        }}
        orgFilter={orgFilter}
        orgName={all[0]?.orgName}
        onClearOrg={() => {
          params.delete("org");
          setParams(params, { replace: true });
        }}
      >
        <RestoreSelectedBar
          count={restorable.length}
          pending={restoreMany.isPending}
          onClear={selection.clear}
          onRestore={() => restoreMany.mutate(restorable, { onSuccess: selection.clear })}
        />
      </OwnedLinksToolbar>

      <LinksTable
        selectedIds={selection.ids}
        onSelect={(l) => selection.toggle(l.id, !selection.has(l.id))}
        onSelectAll={(on) => rows.forEach((l) => selection.toggle(l.id, on))}
        rows={rows}
        isPending={isPending}
        sort={sort}
        onSort={setSort}
        onSuspend={onSuspend}
        onRestore={setRestoring}
        onDelete={setDeleting}
        onRescore={(link) => rescore.mutate(link.id)}
        rescoringId={pendingId(rescore)}
        onWarn={(link) => warn.mutate(link)}
        warningId={pendingLinkId(warn)}
      />
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <RestoreLinkDialog
        link={restoring}
        pending={restore.isPending}
        onClose={() => setRestoring(null)}
        onConfirm={restore.mutate}
      />

      <DeleteLinkDialog
        link={deleting}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={remove.mutate}
      >
        and its clicks are removed for good. Suspending stops a link without losing the evidence,
        and can be undone; this cannot.
      </DeleteLinkDialog>
    </div>
  );
}

export function AdminLinksPage() {
  const [view, setView] = useState<View>("links");
  const [suspending, setSuspending] = useState<AdminLinkRow | null>(null);
  const panels = {
    links: <OwnedLinks onSuspend={setSuspending} />,
    reports: <Reports />,
    blocked: <BlockedHosts />,
    anonymous: <AnonymousLinks />,
  } satisfies Record<View, React.ReactNode>;

  return (
    // The header keeps its own bottom margin, the one every page has; the gap
    // below only spaces the tabs from the panel. Inside one gap container the
    // two added up, and the tabs sat 40px under the subtitle instead of 24.
    <div>
      <PageHeader
        title="Links"
        sub="Every link across every organization. Search by slug or destination."
      />
      <div className="flex flex-col gap-4">
        <Segmented items={VIEWS} value={view} onChange={setView} label="Link lists" />
        {panels[view]}
      </div>

      <SuspendDialog link={suspending} onClose={() => setSuspending(null)} />
    </div>
  );
}
