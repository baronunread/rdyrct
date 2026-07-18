import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, Trash2 } from "lucide-react";
import { useMe, useMembers, useInvites } from "../lib/hooks";
import { api } from "../lib/api";
import type { OrgRole } from "@/shared/types";
import { Button } from "../ui/button";
import { Field, Select } from "../ui/field";
import { Dialog } from "../ui/dialog";
import {
  Table,
  Th,
  Td,
  Badge,
  Card,
  PageHeader,
  Spinner,
} from "../ui/misc";
import { useToast } from "../ui/toast";

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

export function MembersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const me = useMe();
  const members = useMembers(orgId!);
  const qc = useQueryClient();
  const toast = useToast();

  const myRole: OrgRole = me.data?.user.isAdmin
    ? "owner"
    : (me.data?.orgs.find((o) => o.id === orgId)?.role ?? "member");
  const canManage = myRole === "owner" || myRole === "admin";

  const invites = useInvites(orgId!, canManage);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  const invalidateMembers = () =>
    qc.invalidateQueries({ queryKey: ["members", orgId] });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api(`/orgs/${orgId}/members/${userId}`, {
        method: "PATCH",
        body: { role },
      }),
    onSuccess: invalidateMembers,
    onError: (e) => toast(e.message, "error"),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: invalidateMembers,
    onError: (e) => toast(e.message, "error"),
  });

  const createInvite = useMutation({
    mutationFn: () =>
      api<{ token: string }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: inviteRole },
      }),
    onSuccess: (invite) => {
      qc.invalidateQueries({ queryKey: ["invites", orgId] });
      copyInvite(invite.token);
      setInviteOpen(false);
    },
    onError: (e) => toast(e.message, "error"),
  });

  const revokeInvite = useMutation({
    mutationFn: (token: string) =>
      api(`/orgs/${orgId}/invites/${token}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", orgId] }),
  });

  const copyInvite = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast("Invite link copied");
  };

  if (members.isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Members"
        sub="People with access to this organization"
        action={
          canManage && (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus size={15} /> Invite
            </Button>
          )
        }
      />

      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Joined</Th>
            {canManage && <Th className="text-right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => (
            <tr key={m.userId}>
              <Td>{m.name}</Td>
              <Td className="text-muted">{m.email}</Td>
              <Td>
                {canManage && m.role !== "owner" ? (
                  <Select
                    className="h-7 w-28 text-xs"
                    value={m.role}
                    onChange={(e) =>
                      setRole.mutate({ userId: m.userId, role: e.target.value })
                    }
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </Select>
                ) : (
                  <Badge color={roleColor[m.role]}>{m.role}</Badge>
                )}
              </Td>
              <Td className="text-xs text-muted">
                {new Date(m.createdAt).toLocaleDateString()}
              </Td>
              {canManage && (
                <Td>
                  {m.role !== "owner" && m.userId !== me.data?.user.id && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => removeMember.mutate(m.userId)}
                        aria-label={`Remove ${m.name}`}
                        className="cursor-pointer rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>

      {canManage && !!invites.data?.length && (
        <Card className="mt-4">
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Pending invites
          </p>
          <ul className="flex flex-col gap-2">
            {invites.data.map((inv) => (
              <li
                key={inv.token}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-muted">
                  …/invite/{inv.token.slice(0, 10)}…
                </span>
                <span className="flex items-center gap-2">
                  <Badge color={inv.role === "admin" ? "mint" : "muted"}>
                    {inv.role}
                  </Badge>
                  <span className="text-xs text-muted">
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => copyInvite(inv.token)}
                    aria-label="Copy invite link"
                    className="cursor-pointer rounded p-1.5 text-muted hover:text-text"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => revokeInvite.mutate(inv.token)}
                    aria-label="Revoke invite"
                    className="cursor-pointer rounded p-1.5 text-muted hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite a teammate">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Creates a single-use invite link (valid 7 days). It is copied to
            your clipboard so you can share it any way you like.
          </p>
          <Field label="Role">
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
            >
              <option value="member">member · manage links</option>
              <option value="admin">admin · manage links and team</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={createInvite.isPending}
              onClick={() => createInvite.mutate()}
            >
              Create invite link
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
