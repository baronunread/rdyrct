import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Ban, Check, Eye, Trash2, Undo2 } from "@/app/ui/icons";
import { HrefLink } from "../../lib/router-search";
import { buttonClass } from "../../ui/button-class";
import { useAdminOrgDetail, useAdminOrgs } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminOrgRow, Sort } from "@/shared/types";
import { AreaChart } from "../../components/charts";
import { Dialog } from "../../ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { PageHeader, Table, Td, Th } from "../../ui/misc";
import { FilterBar, FilterRow, RowMenuTrigger, StateLabel } from "./admin-kit";
import { OrgDetailSkeleton } from "../../components/skeletons";
import { TableSkeleton } from "../../ui/skeleton";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { BanDialog } from "./ban-dialog";
import { HoldReason } from "./hold-reason";
import { paginate } from "./util";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { formatNumber } from "../../lib/numbers";
import { Pager } from "../../ui/pagination";

/** What an empty table says. It names the filter that matched nothing: with
 * only a status picked there is no search term to quote. */
function emptyMessage(status: OrgStatus, term: string): string {
  if (term) return `No organizations match “${term}”.`;
  if (status === "review") return "No organizations need review.";
  if (status === "suspended") return "No organizations are suspended.";
  return "No organizations yet.";
}

const hasStatus = (o: AdminOrgRow, status: OrgStatus) =>
  status === "all" || (status === "suspended" ? o.linksSuspendedAt : o.reviewFlaggedAt) != null;

const matchesSearch = (o: AdminOrgRow, needle: string) =>
  !needle || [o.name, o.ownerName, o.ownerEmail].some((v) => v?.toLowerCase().includes(needle));

const STATUSES = [
  { id: "all", label: "All" },
  { id: "suspended", label: "Suspended" },
  { id: "review", label: "Needs review" },
] as const;
type OrgStatus = (typeof STATUSES)[number]["id"];

/** Whether an org's links are stopped, and how to say it: a ban outranks a
 * suspension, since it is the decision. */
function stoppedLabel(org: AdminOrgRow, suspendedLabel: string): string | null {
  if (org.disabledAt) return "disabled";
  return org.linksSuspendedAt ? suspendedLabel : null;
}

/** What an admin can still do to an org: nothing to a banned owner's but
 * delete it, since only an unban changes it. */
function orgDecisions(org: AdminOrgRow) {
  const open = !org.disabledAt;
  return { canRestore: open && !!org.linksSuspendedAt, canBan: open && !!org.ownerId };
}

/** The owner a ban from this row is about. */
function ownerOf(org: AdminOrgRow) {
  return org.ownerId
    ? { id: org.ownerId, name: org.ownerName ?? org.ownerEmail ?? "the owner" }
    : null;
}

/** The states an admin acts on, as a dot and a word each, or "active" when
 * there is none. `suspendedLabel` differs: the table is cramped, the dialog
 * has room. */
function OrgStates({ org, suspendedLabel }: { org: AdminOrgRow; suspendedLabel: string }) {
  const stopped = stoppedLabel(org, suspendedLabel);
  if (!stopped && !org.reviewFlaggedAt) return <StateLabel tone="ok">active</StateLabel>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {stopped && <StateLabel tone="bad">{stopped}</StateLabel>}
      {org.reviewFlaggedAt && <StateLabel tone="warn">needs review</StateLabel>}
    </span>
  );
}

function OrgMenu({
  org,
  onView,
  onDelete,
  onAct,
  onBanOwner,
}: {
  org: AdminOrgRow;
  onView: () => void;
  onDelete: () => void;
  onAct: (path: string, body?: { reason: string }) => void;
  onBanOwner: () => void;
}) {
  const { canRestore, canBan } = orgDecisions(org);
  return (
    <Menu align="end" label={`Actions for ${org.name}`} trigger={<RowMenuTrigger />}>
      <MenuItem onClick={onView}>
        <Eye size={14} /> View details
      </MenuItem>
      {org.reviewFlaggedAt && (
        <MenuItem onClick={() => onAct("reviewed")}>
          <Check size={14} /> Mark reviewed
        </MenuItem>
      )}
      {canRestore && (
        <MenuItem onClick={() => onAct("suspend?suspend=0", { reason: "" })}>
          <Undo2 size={14} /> Restore links
        </MenuItem>
      )}
      <MenuSeparator />
      {canBan && (
        <MenuItem className="text-danger" onClick={onBanOwner}>
          <Ban size={14} /> Ban owner…
        </MenuItem>
      )}
      <MenuItem className="text-danger" onClick={onDelete}>
        <Trash2 size={14} /> Delete organization
      </MenuItem>
    </Menu>
  );
}

/** The org's name over its owner's address: the name opens the details, the
 * address is what a report or an email names. */
function OrgCell({ org, onView }: { org: AdminOrgRow; onView: () => void }) {
  const owner = org.ownerName ? `${org.ownerName} · ${org.ownerEmail ?? ""}` : "No owner";
  return (
    <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
      <button
        type="button"
        onClick={onView}
        title={org.name}
        className="max-w-full cursor-pointer truncate text-start text-sm font-semibold [@media(hover:hover)]:hover:underline"
      >
        {org.name}
      </button>
      {org.ownerEmail ? (
        <span className="truncate font-mono text-xs text-muted" title={owner}>
          {org.ownerEmail}
        </span>
      ) : (
        <span className="text-xs text-muted">No owner</span>
      )}
    </span>
  );
}

function OrgRow({
  org,
  onView,
  onDelete,
  onBanOwner,
  onAct,
}: {
  org: AdminOrgRow;
  onView: () => void;
  onDelete: () => void;
  onBanOwner: () => void;
  onAct: (path: string, body?: { reason: string }) => void;
}) {
  return (
    <tr>
      <Td>
        <OrgCell org={org} onView={onView} />
      </Td>
      <Td className={org.plan === "free" ? "text-muted capitalize" : "capitalize"}>{org.plan}</Td>
      <Td className="tnum text-right">{formatNumber(org.links)}</Td>
      <Td className="tnum text-right">{formatNumber(org.members)}</Td>
      <Td className="tnum text-right">{formatNumber(org.clicks)}</Td>
      <Td>
        <OrgStates org={org} suspendedLabel="suspended" />
        <HoldReason why={org.linksSuspendedAt ? org.suspendReason : null} />
      </Td>
      <Td className="tnum text-xs whitespace-nowrap text-muted">{shortDate(org.createdAt)}</Td>
      <Td className="px-2">
        <OrgMenu
          org={org}
          onView={onView}
          onDelete={onDelete}
          onAct={onAct}
          onBanOwner={onBanOwner}
        />
      </Td>
    </tr>
  );
}

function OrgRows({
  rows,
  emptyText,
  onView,
  onDelete,
  onBanOwner,
  onAct,
}: {
  rows: AdminOrgRow[];
  emptyText: string;
  onView: (org: AdminOrgRow) => void;
  onDelete: (org: AdminOrgRow) => void;
  onBanOwner: (org: AdminOrgRow) => void;
  onAct: (org: AdminOrgRow, path: string, body?: { reason: string }) => void;
}) {
  if (rows.length === 0)
    return (
      <tr>
        <Td colSpan={8} className="py-8 text-center text-muted">
          {emptyText}
        </Td>
      </tr>
    );
  return rows.map((org) => (
    <OrgRow
      key={org.id}
      org={org}
      onView={() => onView(org)}
      onDelete={() => onDelete(org)}
      onBanOwner={() => onBanOwner(org)}
      onAct={(path, body) => onAct(org, path, body)}
    />
  ));
}

function OrgMembersTable({
  members,
}: {
  members: NonNullable<ReturnType<typeof useAdminOrgDetail>["data"]>["members"];
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted">Members</p>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <Td className="font-semibold">{m.name}</Td>
              <Td className="truncate font-mono text-xs text-muted" title={m.email}>
                {m.email}
              </Td>
              {/* A role is an attribute of the row: text, not a pill. */}
              <Td className="text-muted capitalize">{m.role}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/**
 * A count and a way through, instead of the org's links inline.
 *
 * The dialog listed every link with its destination, which is the Links tab's
 * job and did it worse: no search, no sort, no suspend. This says how many
 * there are and hands the question over.
 */
function OrgLinksRecap({
  orgId,
  links,
  onNavigate,
}: {
  orgId: string;
  links: NonNullable<ReturnType<typeof useAdminOrgDetail>["data"]>["links"];
  onNavigate: () => void;
}) {
  const clicks = links.reduce((total, link) => total + link.clicks, 0);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-4 py-3">
      <div className="flex-1">
        <p className="text-xs text-muted">Links</p>
        <p className="mt-0.5 text-sm">
          <span className="font-semibold tnum">{formatNumber(links.length)}</span>{" "}
          {links.length === 1 ? "link" : "links"},{" "}
          <span className="font-semibold tnum">{formatNumber(clicks)}</span> clicks between them
        </p>
      </div>
      <HrefLink
        href={`/admin/links?org=${encodeURIComponent(orgId)}`}
        onClick={onNavigate}
        className={buttonClass({ size: "sm", variant: "outline" })}
      >
        Open in Links <ArrowRight size={13} />
      </HrefLink>
    </div>
  );
}

function OrgDetailDialog({ org, onClose }: { org: AdminOrgRow | null; onClose: () => void }) {
  const detail = useAdminOrgDetail(org?.id ?? null);
  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()} title={org?.name ?? ""} wide>
      {org && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="capitalize">{org.plan}</span>
            <OrgStates org={org} suspendedLabel="links suspended" />
            <span className="text-xs text-muted">Created {shortDate(org.createdAt)}</span>
          </div>

          {detail.isLoading || !detail.data ? (
            <OrgDetailSkeleton />
          ) : (
            <>
              <div>
                <p className="mb-1 text-xs text-muted">Clicks per day, last 30 days</p>
                <AreaChart data={detail.data.series} />
              </div>

              <OrgMembersTable members={detail.data.members} />
              <OrgLinksRecap
                orgId={detail.data.id}
                links={detail.data.links}
                onNavigate={onClose}
              />
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AdminOrgsPage() {
  const orgs = useAdminOrgs();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<AdminOrgRow | null>(null);
  const [viewing, setViewing] = useState<AdminOrgRow | null>(null);
  const [banning, setBanning] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrgStatus>("all");
  const [sort, setSort] = useState<Sort>({ key: "created", dir: -1 });
  const [page, setPage] = useState(0);

  const remove = useMutation({
    mutationFn: (orgId: string) => api(`/admin/orgs/${orgId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["user"] });
      setDeleting(null);
      toast("Organization deleted");
    },
    onError: withErrorToast(toast),
  });

  // Both actions answer the same flag, so one mutation with a path.
  const act = useMutation({
    mutationFn: (input: { orgId: string; path: string; body?: { reason: string } }) =>
      api(`/admin/links/orgs/${input.orgId}/${input.path}`, { method: "POST", body: input.body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast("Done.");
    },
    onError: withErrorToast(toast),
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = (orgs.data ?? []).filter(
      (o) => hasStatus(o, status) && matchesSearch(o, needle),
    );
    return sortRows(matches, sort, {
      name: (o) => o.name.toLowerCase(),
      members: (o) => o.members,
      links: (o) => o.links,
      clicks: (o) => o.clicks,
      created: (o) => o.createdAt,
    });
  }, [orgs.data, q, status, sort]);

  const { totalPages, safePage, rows } = paginate(filtered, page);
  const counts = useMemo(
    () =>
      STATUSES.map((s) => ({
        ...s,
        count: (orgs.data ?? []).filter((o) => hasStatus(o, s.id)).length,
      })),
    [orgs.data],
  );

  return (
    <div>
      <PageHeader title="Organizations" sub="All organizations on this instance." />
      <div className="mb-4">
        <FilterBar>
          <FilterRow
            label="Filter organizations"
            items={counts}
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(0);
            }}
          />
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(0);
            }}
            placeholder="Search organization or owner"
            label="Search organizations"
          />
        </FilterBar>
      </div>
      {/* Rows only: the header and search box above are real, so the
          page-level skeleton would draw a second one of each. */}
      {orgs.isLoading ? (
        <TableSkeleton rows={6} testId="admin-orgs-rows-skeleton" />
      ) : (
        <Table fixed minWidth="min-w-[54rem]">
          <thead>
            <tr>
              <SortTh label="Organization" sortKey="name" sort={sort} onSort={setSort} />
              <Th className="w-20">Plan</Th>
              <SortTh
                label="Links"
                sortKey="links"
                sort={sort}
                onSort={setSort}
                className="w-20 text-right"
              />
              <SortTh
                label="Members"
                sortKey="members"
                sort={sort}
                onSort={setSort}
                className="w-24 text-right"
              />
              <SortTh
                label="Clicks"
                sortKey="clicks"
                sort={sort}
                onSort={setSort}
                className="w-24 text-right"
              />
              <Th className="w-36">State</Th>
              <SortTh
                label="Created"
                sortKey="created"
                sort={sort}
                onSort={setSort}
                className="w-28"
              />
              <Th className="w-12 px-2">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            <OrgRows
              rows={rows}
              emptyText={emptyMessage(status, q.trim())}
              onView={setViewing}
              onDelete={setDeleting}
              onBanOwner={(org) => setBanning(ownerOf(org))}
              onAct={(org, path, body) => act.mutate({ orgId: org.id, path, body })}
            />
          </tbody>
        </Table>
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <OrgDetailDialog org={viewing} onClose={() => setViewing(null)} />
      <BanDialog user={banning} onClose={() => setBanning(null)} />

      <ConfirmDialog
        title="Delete organization"
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        confirmLabel="Delete organization"
        danger
        pending={remove.isPending}
      >
        {deleting && (
          <>
            Delete <span className="font-semibold">{deleting.name}</span> with {deleting.links}{" "}
            links and {deleting.clicks} recorded clicks? All its short links stop working. This
            cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
