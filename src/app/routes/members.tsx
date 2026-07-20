import { useState } from "react";
import { useCurrentOrg } from "../lib/current-org";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, Trash2, Info } from "lucide-react";
import { useCurrentUser, useMembers, useInvites } from "../lib/hooks";
import { api } from "../lib/api";
import { PLAN_LIMITS, type InviteDTO, type OrgRole } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { Dialog } from "../ui/dialog";
import { Tooltip } from "../ui/tooltip";
import {
  Table,
  Th,
  Td,
  Badge,
  Card,
  PageHeader,
} from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

export function MembersPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const members = useMembers(orgId);
  const qc = useQueryClient();
  const toast = useToast();

  const myRole: OrgRole = me.data?.user.isAdmin
    ? "owner"
    : (org?.role ?? "member");
  const canManage = myRole === "owner" || myRole === "admin";

  const invites = useInvites(orgId, canManage);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  const [emailInput, setEmailInput] = useState("");
  const [emailRole, setEmailRole] = useState<"member" | "admin">("member");

  const invalidateMembers = () =>
    qc.invalidateQueries({ queryKey: ["members", orgId] });
  const invalidateInvites = () =>
    qc.invalidateQueries({ queryKey: ["invites", orgId] });

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
      api<{ invites: InviteDTO[] }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: inviteRole },
      }),
    onSuccess: ({ invites }) => {
      invalidateInvites();
      const invite = invites[0];
      if (invite) copyInvite(invite.token);
      setInviteOpen(false);
    },
    onError: (e) => toast(e.message, "error"),
  });

  const sendEmailInvite = useMutation({
    mutationFn: (email: string) =>
      api<{ invites: InviteDTO[] }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: emailRole, emails: [email] },
      }),
    onSuccess: () => {
      invalidateInvites();
      setEmailInput("");
      toast("Invite sent");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const revokeInvite = useMutation({
    mutationFn: (token: string) =>
      api(`/orgs/${orgId}/invites/${token}`, { method: "DELETE" }),
    onSuccess: invalidateInvites,
  });

  const copyInvite = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast("Invite link copied");
  };

  const memberLimit = org ? PLAN_LIMITS[org.plan].members : 0;

  if (!org) return <NoOrgState />;

  return (
    <div>
      <PageHeader
        title="Members"
        sub="People with access to this organization"
        action={
          canManage && (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus size={15} /> Invite link
            </Button>
          )
        }
      />

      {members.isLoading ? (
        <TableSkeleton rows={4} />
      ) : (
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
                      className="h-7 text-xs"
                      wrapperClass="inline-block w-28"
                      value={m.role}
                      onChange={(e) =>
                        setRole.mutate({
                          userId: m.userId,
                          role: e.target.value,
                        })
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
                        <IconButton
                          label={`Remove ${m.name}`}
                          danger
                          onClick={() => removeMember.mutate(m.userId)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canManage && org && (
        <Card className="mt-4">
          <div className="mb-3 flex items-center gap-1.5">
            <p className="text-[11px] tracking-wider text-muted uppercase">
              Invite by email
            </p>
            <Tooltip
              content={
                <>
                  You can invite up to {memberLimit} members on the{" "}
                  {org.plan} plan. Pending invites count toward the limit.
                </>
              }
            >
              <button
                type="button"
                aria-label="Member limit info"
                className="cursor-pointer text-muted hover:text-text"
              >
                <Info size={13} />
              </button>
            </Tooltip>
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Email">
                <Input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="teammate@company.com"
                />
              </Field>
            </div>
            <div className="w-36">
              <Field label="Role">
                <Select
                  value={emailRole}
                  onChange={(e) =>
                    setEmailRole(e.target.value as "member" | "admin")
                  }
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </Select>
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={sendEmailInvite.isPending || !emailInput.trim()}
              onClick={() => sendEmailInvite.mutate(emailInput.trim())}
            >
              {sendEmailInvite.isPending ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                "Send invite"
              )}
            </Button>
          </div>
        </Card>
      )}

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
                  {inv.email ?? "link invite"}
                </span>
                <span className="flex items-center gap-2">
                  <Badge color={inv.role === "admin" ? "mint" : "muted"}>
                    {inv.role}
                  </Badge>
                  <span className="text-xs text-muted">
                    expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <IconButton
                    label="Copy invite link"
                    onClick={() => copyInvite(inv.token)}
                  >
                    <Copy size={14} />
                  </IconButton>
                  <IconButton
                    label="Revoke invite"
                    danger
                    onClick={() => revokeInvite.mutate(inv.token)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
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
