import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Eye, Trash2 } from "lucide-react";
import { useAdminOrgDetail, useAdminOrgs } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminOrgRow, OrgPlan, OrgRole, Sort } from "@/shared/types";
import { AreaChart } from "../../components/charts";
import { Dialog } from "../../ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, Card, PageHeader, Table, Td, Th } from "../../ui/misc";
import { AdminTableSkeleton, OrgDetailSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { linkLabel } from "./util";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { Pager } from "../../ui/pagination";

const PAGE_SIZE = 25;

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

const planBadgeColor: Record<OrgPlan, "accent" | "mint" | "muted"> = {
  pro: "mint",
  hobby: "accent",
  free: "muted",
};

function OrgMembersTable({
  members,
}: {
  members: NonNullable<ReturnType<typeof useAdminOrgDetail>["data"]>["members"];
}) {
  return (
    <div>
      <p className="mb-2 text-2xs tracking-wider text-muted uppercase">Members</p>
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

function OrgLinksTable({
  links,
}: {
  links: NonNullable<ReturnType<typeof useAdminOrgDetail>["data"]>["links"];
}) {
  return (
    <div>
      <p className="mb-2 text-2xs tracking-wider text-muted uppercase">Links</p>
      <Table>
        <thead>
          <tr>
            <Th>Short link</Th>
            <Th>Destination</Th>
            <Th className="text-right">Clicks</Th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.id}>
              <Td className="font-bold text-accent">{linkLabel(l)}</Td>
              <Td className="max-w-64 truncate text-muted">{l.destination}</Td>
              <Td className="tnum text-right">{l.clicks}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
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
            <Badge color={planBadgeColor[org.plan]}>{org.plan}</Badge>
            <span className="text-xs text-muted">Created {shortDate(org.createdAt)}</span>
          </div>

          {detail.isLoading || !detail.data ? (
            <OrgDetailSkeleton />
          ) : (
            <>
              <Card>
                <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
                  Clicks per day · 30d
                </p>
                <AreaChart data={detail.data.series} />
              </Card>

              <OrgMembersTable members={detail.data.members} />
              <OrgLinksTable links={detail.data.links} />
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
  const [q, setQ] = useState("");
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = (orgs.data ?? []).filter(
      (o) =>
        !needle ||
        o.name.toLowerCase().includes(needle) ||
        (o.ownerName?.toLowerCase().includes(needle) ?? false) ||
        (o.ownerEmail?.toLowerCase().includes(needle) ?? false),
    );
    return sortRows(matches, sort, {
      name: (o) => o.name.toLowerCase(),
      owner: (o) => o.ownerName?.toLowerCase() ?? "",
      members: (o) => o.members,
      links: (o) => o.links,
      clicks: (o) => o.clicks,
      created: (o) => o.createdAt,
    });
  }, [orgs.data, q, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (orgs.isLoading) return <AdminTableSkeleton />;
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
      <Table>
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
          {rows.map((org) => (
            <tr key={org.id}>
              <Td className="max-w-48 font-bold">
                <button
                  type="button"
                  onClick={() => setViewing(org)}
                  title={org.name}
                  className="block max-w-full cursor-pointer truncate text-accent hover:underline"
                >
                  {org.name}
                </button>
              </Td>
              <Td className="max-w-48">
                {org.ownerName ? (
                  <>
                    <span className="block truncate" title={org.ownerName}>
                      {org.ownerName}
                    </span>
                    <span
                      className="block truncate text-xs text-muted"
                      title={org.ownerEmail ?? ""}
                    >
                      {org.ownerEmail}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td>
                <Badge color={planBadgeColor[org.plan]}>{org.plan}</Badge>
              </Td>
              <Td className="tnum text-right">{org.members}</Td>
              <Td className="tnum text-right">{org.links}</Td>
              <Td className="tnum text-right">{org.clicks}</Td>
              <Td className="text-xs text-muted">{shortDate(org.createdAt)}</Td>
              <Td>
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
                  <MenuItem onClick={() => setViewing(org)}>
                    <Eye size={14} /> View details
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem className="text-danger" onClick={() => setDeleting(org)}>
                    <Trash2 size={14} /> Delete organization
                  </MenuItem>
                </Menu>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={8} className="py-8 text-center text-muted">
                No organizations match “{q.trim()}”.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <OrgDetailDialog org={viewing} onClose={() => setViewing(null)} />

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
