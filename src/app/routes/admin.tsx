import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  useAdminOverview,
  useAdminOrgs,
  useAdminOrgDetail,
  useAdminUsers,
  useMe,
} from "../lib/hooks";
import { api } from "../lib/api";
import type { AdminOrgRow, OrgRole, OrgPlan } from "@/shared/types";
import { AreaChart, StatCard } from "../components/charts";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Menu, MenuItem } from "../ui/menu";
import {
  Card,
  Table,
  Th,
  Td,
  Badge,
  PageHeader,
  Spinner,
} from "../ui/misc";
import { useToast } from "../ui/toast";

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

const linkLabel = (l: { domain: string | null; slug: string }) =>
  l.domain ? `${l.domain}/${l.slug}` : `/${l.slug}`;

export function AdminOverviewPage() {
  const overview = useAdminOverview();
  if (overview.isLoading) return <Spinner />;
  if (!overview.data)
    return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = overview.data;
  return (
    <div>
      <PageHeader title="Platform usage" sub="Everything, across all organizations" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Users" value={s.users} />
        <StatCard label="Orgs" value={s.orgs} />
        <StatCard label="Links" value={s.links} />
        <StatCard label="Clicks" value={s.clicks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} />
      </div>
      <Card className="mt-4">
        <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
          Clicks per day · all orgs
        </p>
        <AreaChart data={s.series} />
      </Card>
    </div>
  );
}

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
            <Badge color={org.plan === "pro" ? "mint" : "muted"}>
              {org.plan}
            </Badge>
            <span className="text-xs text-muted">
              Created {new Date(org.createdAt).toLocaleDateString()}
            </span>
          </div>

          {detail.isLoading || !detail.data ? (
            <Spinner />
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

  if (orgs.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title="Organizations" sub="All organizations on this instance" />
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Plan</Th>
            <Th className="text-right">Members</Th>
            <Th className="text-right">Links</Th>
            <Th className="text-right">Clicks</Th>
            <Th>Created</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {orgs.data?.map((org) => (
            <tr key={org.id}>
              <Td className="font-bold">
                <button
                  onClick={() => setViewing(org)}
                  className="cursor-pointer text-accent hover:underline"
                >
                  {org.name}
                </button>
              </Td>
              <Td>
                <Badge color={org.plan === "pro" ? "mint" : "muted"}>
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
                <div className="flex justify-end">
                  <button
                    onClick={() => setDeleting(org)}
                    aria-label={`Delete ${org.name}`}
                    className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <OrgDetailDialog org={viewing} onClose={() => setViewing(null)} />

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete organization"
      >
        {deleting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Delete <span className="font-bold text-accent">{deleting.name}</span>{" "}
              with {deleting.links} links and {deleting.clicks} recorded clicks?
              All its short links stop working. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
              >
                Delete organization
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function AdminUsersPage() {
  const users = useAdminUsers();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(
    null,
  );

  const setAdmin = useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      api(`/admin/users/${userId}`, { method: "PATCH", body: { isAdmin } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      setDeleting(null);
      toast("User deleted");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const setPlan = useMutation({
    mutationFn: ({ userId, plan }: { userId: string; plan: OrgPlan }) =>
      api(`/admin/users/${userId}`, { method: "PATCH", body: { plan } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast("Plan updated");
    },
    onError: (e) => toast(e.message, "error"),
  });

  if (users.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title="Users" sub="All accounts on this instance" />
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th className="text-right">Orgs</Th>
            <Th>Plan</Th>
            <Th>Joined</Th>
            <Th className="text-right">Platform admin</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.name}{" "}
                {u.isAdmin && <Badge color="butter">admin</Badge>}
              </Td>
              <Td className="text-muted">{u.email}</Td>
              <Td className="tnum text-right">{u.orgCount}</Td>
              <Td>
                <Menu
                  trigger={
                    <Badge color={u.plan === "pro" ? "mint" : "muted"}>
                      {u.plan}
                    </Badge>
                  }
                >
                  <MenuItem
                    onClick={() => setPlan.mutate({ userId: u.id, plan: "free" })}
                  >
                    Set free
                  </MenuItem>
                  <MenuItem
                    onClick={() => setPlan.mutate({ userId: u.id, plan: "pro" })}
                  >
                    Set pro
                  </MenuItem>
                </Menu>
              </Td>
              <Td className="text-xs text-muted">
                {new Date(u.createdAt).toLocaleDateString()}
              </Td>
              <Td>
                <div className="flex justify-end">
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={u.id === me.data?.user.id}
                    onChange={(e) =>
                      setAdmin.mutate({ userId: u.id, isAdmin: e.target.checked })
                    }
                    className="size-4 cursor-pointer accent-(--accent)"
                    aria-label={`Toggle platform admin for ${u.name}`}
                  />
                </div>
              </Td>
              <Td>
                <div className="flex justify-end">
                  <button
                    onClick={() => setDeleting({ id: u.id, name: u.name })}
                    disabled={u.id === me.data?.user.id}
                    aria-label={`Delete ${u.name}`}
                    className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete user"
      >
        {deleting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Delete <span className="font-bold text-accent">{deleting.name}</span>?
              Their sessions, linked accounts, and org memberships are removed.
              Links and invites they created stay, unattributed. If they own any
              organization, delete that organization first. This cannot be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
              >
                Delete user
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
