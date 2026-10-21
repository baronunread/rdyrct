import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Ban, Check, Ellipsis, Eye, Trash2, Undo2 } from "@/app/ui/icons";
import { HrefLink } from "../../lib/router-search";
import { buttonClass } from "../../ui/button-class";
import { useAdminOrgDetail, useAdminOrgs } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminOrgRow, OrgRole, Sort } from "@/shared/types";
import { AreaChart } from "../../components/charts";
import { Dialog } from "../../ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, Card, PageHeader, Table, Td, Th } from "../../ui/misc";
import { OrgDetailSkeleton } from "../../components/skeletons";
import { TableSkeleton } from "../../ui/skeleton";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { AbuseDialog } from "./abuse-dialog";
import { paginate } from "./util";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { formatNumber } from "../../lib/numbers";
import { Pager } from "../../ui/pagination";
import { Segmented } from "../../ui/segmented";

const roleColor = {
  owner: "accent",
  admin: "mint",
  member: "muted",
  viewer: "muted",
} satisfies Record<OrgRole, "accent" | "mint" | "muted">;

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

/** Plan, plus the two states an admin acts on. `suspendedLabel` differs: the
 * table is cramped, the dialog has room. */
function OrgBadges({ org, suspendedLabel }: { org: AdminOrgRow; suspendedLabel: string }) {
  return (
    <>
      <span className="mr-1.5">{org.plan}</span>
      {org.linksSuspendedAt && <Badge color="pink">{suspendedLabel}</Badge>}{" "}
      {org.reviewFlaggedAt && <Badge color="butter">needs review</Badge>}
    </>
  );
}

function OrgMenu({
  org,
  onView,
  onDelete,
  onAct,
  onAbuse,
}: {
  org: AdminOrgRow;
  onView: () => void;
  onDelete: () => void;
  onAct: (path: string, body?: { reason: string }) => void;
  onAbuse: () => void;
}) {
  return (
    <Menu
      align="end"
      label={`Actions for ${org.name}`}
      trigger={
        <div className="flex justify-end">
          <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
            <Ellipsis size={15} />
          </span>
        </div>
      }
    >
      <MenuItem onClick={onView}>
        <Eye size={14} /> View details
      </MenuItem>
      {org.reviewFlaggedAt && (
        <MenuItem onClick={() => onAct("reviewed")}>
          <Check size={14} /> Mark reviewed
        </MenuItem>
      )}
      {org.linksSuspendedAt && (
        <MenuItem onClick={() => onAct("suspend?suspend=0", { reason: "" })}>
          <Undo2 size={14} /> Restore links
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem className="text-danger" onClick={onAbuse}>
        <Ban size={14} /> Mark as abuse…
      </MenuItem>
      <MenuItem className="text-danger" onClick={onDelete}>
        <Trash2 size={14} /> Delete organization
      </MenuItem>
    </Menu>
  );
}

function OrgOwner({ org }: { org: AdminOrgRow }) {
  if (!org.ownerName) return <span className="text-muted">No owner</span>;
  return (
    <>
      <span className="block truncate" title={org.ownerName}>
        {org.ownerName}
      </span>
      <span className="block truncate text-xs text-muted" title={org.ownerEmail ?? ""}>
        {org.ownerEmail}
      </span>
    </>
  );
}

function OrgRow({
  org,
  onView,
  onDelete,
  onAbuse,
  onAct,
}: {
  org: AdminOrgRow;
  onView: () => void;
  onDelete: () => void;
  onAbuse: () => void;
  onAct: (path: string, body?: { reason: string }) => void;
}) {
  return (
    <tr>
      <Td className="max-w-48 font-bold">
        <button
          type="button"
          onClick={onView}
          title={org.name}
          className="block max-w-full cursor-pointer truncate text-accent hover:underline"
        >
          {org.name}
        </button>
      </Td>
      <Td className="max-w-48">
        <OrgOwner org={org} />
      </Td>
      <Td>
        <OrgBadges org={org} suspendedLabel="suspended" />
      </Td>
      <Td className="tnum text-right">{org.members}</Td>
      <Td className="tnum text-right">{org.links}</Td>
      <Td className="tnum text-right">{org.clicks}</Td>
      <Td className="text-xs text-muted">{shortDate(org.createdAt)}</Td>
      <Td>
        <OrgMenu org={org} onView={onView} onDelete={onDelete} onAct={onAct} onAbuse={onAbuse} />
      </Td>
    </tr>
  );
}

function OrgRows({
  rows,
  emptyText,
  onView,
  onDelete,
  onAbuse,
  onAct,
}: {
  rows: AdminOrgRow[];
  emptyText: string;
  onView: (org: AdminOrgRow) => void;
  onDelete: (org: AdminOrgRow) => void;
  onAbuse: (org: AdminOrgRow) => void;
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
      onAbuse={() => onAbuse(org)}
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
      <p className="mb-2 text-xs font-medium text-muted">Members</p>
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
              <Td>{m.name}</Td>
              <Td className="text-muted">{m.email}</Td>
              <Td>
                <Badge color={roleColor[m.role]}>{m.role}</Badge>
              </Td>
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
        <p className="text-xs font-medium text-muted">Links</p>
        <p className="mt-0.5 text-sm">
          <span className="font-bold tnum">{links.length}</span>{" "}
          {links.length === 1 ? "link" : "links"},{" "}
          <span className="font-bold tnum">{formatNumber(clicks)}</span> clicks between them
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
          <div className="flex items-center gap-2">
            <OrgBadges org={org} suspendedLabel="links suspended" />
            <span className="text-xs text-muted">Created {shortDate(org.createdAt)}</span>
          </div>

          {detail.isLoading || !detail.data ? (
            <OrgDetailSkeleton />
          ) : (
            <>
              <Card>
                <p className="mb-3 text-xs font-medium text-muted">Clicks per day · 30d</p>
                <AreaChart data={detail.data.series} />
              </Card>

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
  const [abusing, setAbusing] = useState<AdminOrgRow | null>(null);
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
      owner: (o) => o.ownerName?.toLowerCase() ?? "",
      members: (o) => o.members,
      links: (o) => o.links,
      clicks: (o) => o.clicks,
      created: (o) => o.createdAt,
    });
  }, [orgs.data, q, status, sort]);

  const { totalPages, safePage, rows } = paginate(filtered, page);

  return (
    <div>
      <PageHeader title="Organizations" sub="All organizations on this instance" />
      <SearchInput
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(0);
        }}
        placeholder="Search by org name or owner…"
        label="Search organizations"
      />
      <div className="mb-3">
        <Segmented
          items={STATUSES}
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(0);
          }}
        />
      </div>
      {/* Rows only: the header and search box above are real, so the
          page-level skeleton would draw a second one of each. */}
      {orgs.isLoading ? (
        <TableSkeleton rows={6} testId="admin-orgs-rows-skeleton" />
      ) : (
        <Table minWidth="min-w-[56rem]">
          <thead>
            <tr>
              <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
              <SortTh label="Owner" sortKey="owner" sort={sort} onSort={setSort} />
              <Th>Plan</Th>
              <SortTh
                label="Members"
                sortKey="members"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortTh
                label="Links"
                sortKey="links"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortTh
                label="Clicks"
                sortKey="clicks"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortTh label="Created" sortKey="created" sort={sort} onSort={setSort} />
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            <OrgRows
              rows={rows}
              emptyText={emptyMessage(status, q.trim())}
              onView={setViewing}
              onDelete={setDeleting}
              onAbuse={setAbusing}
              onAct={(org, path, body) => act.mutate({ orgId: org.id, path, body })}
            />
          </tbody>
        </Table>
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <OrgDetailDialog org={viewing} onClose={() => setViewing(null)} />
      <AbuseDialog org={abusing} onClose={() => setAbusing(null)} />

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
            Delete <span className="font-bold text-accent">{deleting.name}</span> with{" "}
            {deleting.links} links and {deleting.clicks} recorded clicks? All its short links stop
            working. This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
