import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Eye, Trash2 } from "lucide-react";
import { useAdminOrgDetail, useAdminOrgs } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminOrgRow, OrgRole } from "@/shared/types";
import { AreaChart } from "../../components/charts";
import { Dialog } from "../../ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, Card, PageHeader, Table, Td, Th } from "../../ui/misc";
import {
  AdminTableSkeleton,
  OrgDetailSkeleton,
} from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "./confirm-dialog";
import { SearchInput } from "./search-input";
import { SortTh } from "./sort";
import { linkLabel, sortRows, type Sort } from "./util";

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

function OrgDetailDialog({
  org,
  onClose,
}: {
  org: AdminOrgRow | null;
  onClose: () => void;
}) {
  const detail = useAdminOrgDetail(org?.id ?? null);
  return (
    <Dialog
      open={!!org}
      onOpenChange={(o) => !o && onClose()}
      title={org?.name ?? ""}
      wide
    >
      {org && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge color={org.plan === "pro" ? "mint" : org.plan === "hobby" ? "accent" : "muted"}>
              {org.plan}
            </Badge>
            <span className="text-xs text-muted">
              Created {new Date(org.createdAt).toLocaleDateString()}
            </span>
          </div>

          {detail.isLoading || !detail.data ? (
            <OrgDetailSkeleton />
          ) : (
            <>
              <Card>
                <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
                  Clicks per day · 30d
                </p>
                <AreaChart data={detail.data.series} />
              </Card>

              <div>
                <p className="mb-2 text-[11px] tracking-wider text-muted uppercase">
                  Members
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Role</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.members.map((m) => (
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

              <div>
                <p className="mb-2 text-[11px] tracking-wider text-muted uppercase">
                  Links
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>Short link</Th>
                      <Th>Destination</Th>
                      <Th className="text-right">Clicks</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.links.map((l) => (
                      <tr key={l.id}>
                        <Td className="font-bold text-accent">
                          {linkLabel(l)}
                        </Td>
                        <Td className="max-w-64 truncate text-muted">
                          {l.destination}
                        </Td>
                        <Td className="tnum text-right">{l.clicks}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
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

  const remove = useMutation({
    mutationFn: (orgId: string) =>
      api(`/admin/orgs/${orgId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["user"] });
      setDeleting(null);
      toast("Organization deleted");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (orgs.data ?? []).filter(
      (o) => !needle || o.name.toLowerCase().includes(needle),
    );
    return sortRows(filtered, sort, {
      name: (o) => o.name.toLowerCase(),
      members: (o) => o.members,
      links: (o) => o.links,
      clicks: (o) => o.clicks,
      created: (o) => o.createdAt,
    });
  }, [orgs.data, q, sort]);

  if (orgs.isLoading) return <AdminTableSkeleton />;
  return (
    <div>
      <PageHeader
        title="Organizations"
        sub="All organizations on this instance"
      />
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Search organizations…"
        label="Search organizations"
      />
      <Table>
        <thead>
          <tr>
            <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
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
            <SortTh
              label="Created"
              sortKey="created"
              sort={sort}
              onSort={setSort}
            />
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((org) => (
            <tr key={org.id}>
              <Td className="font-bold">
                <button
                  type="button"
                  onClick={() => setViewing(org)}
                  className="cursor-pointer text-accent hover:underline"
                >
                  {org.name}
                </button>
              </Td>
              <Td>
                <Badge color={org.plan === "pro" ? "mint" : org.plan === "hobby" ? "accent" : "muted"}>
                  {org.plan}
                </Badge>
              </Td>
              <Td className="tnum text-right">{org.members}</Td>
              <Td className="tnum text-right">{org.links}</Td>
              <Td className="tnum text-right">{org.clicks}</Td>
              <Td className="text-xs text-muted">
                {new Date(org.createdAt).toLocaleDateString()}
              </Td>
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
                  <MenuItem
                    className="text-danger"
                    onClick={() => setDeleting(org)}
                  >
                    <Trash2 size={14} /> Delete organization
                  </MenuItem>
                </Menu>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-8 text-center text-muted">
                No organizations match “{q.trim()}”.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

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
            Delete{" "}
            <span className="font-bold text-accent">{deleting.name}</span> with{" "}
            {deleting.links} links and {deleting.clicks} recorded clicks? All
            its short links stop working. This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
