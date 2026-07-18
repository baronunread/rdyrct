import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  useAdminOverview,
  useAdminOrgs,
  useAdminUsers,
  useMe,
} from "../lib/hooks";
import { api } from "../lib/api";
import type { AdminOrgRow } from "@/shared/types";
import { AreaChart, StatCard } from "../components/charts";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
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

export function AdminOrgsPage() {
  const orgs = useAdminOrgs();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<AdminOrgRow | null>(null);

  const remove = useMutation({
    mutationFn: (orgId: string) =>
      api(`/admin/orgs/${orgId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["me"] });
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
              <Td className="font-bold">{org.name}</Td>
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

  const setAdmin = useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      api(`/admin/users/${userId}`, { method: "PATCH", body: { isAdmin } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
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
            <Th>Joined</Th>
            <Th className="text-right">Platform admin</Th>
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
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
