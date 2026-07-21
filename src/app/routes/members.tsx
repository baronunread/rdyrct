import { useState, useMemo } from "react";
import { useCurrentOrg } from "../lib/current-org";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Copy, Trash2, Info } from "lucide-react";
import { useCurrentUser, useMembers, useInvites } from "../lib/hooks";
import { api } from "../lib/api";
import { PLAN_LIMITS, type InviteDTO, type OrgRole, type Sort } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { RemoveMemberDialog, InviteMemberDialog } from "../components/member-dialogs";
import {
  Table,
  Th,
  Td,
  Badge,
  Card,
  PageHeader,
} from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { SortTh } from "../ui/sort-th";
import { sortRows } from "../lib/sort";

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

  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailRole, setEmailRole] = useState<"member" | "admin">("member");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: 1 });

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

  const sorted = useMemo(
    () => sortRows(members.data ?? [], sort, {
      name: (m) => m.name.toLowerCase(),
      email: (m) => m.email.toLowerCase(),
      role: (m) => m.role,
      createdAt: (m) => m.createdAt,
    }),
    [members.data, sort],
  );

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

      {canManage && org && (
        <InviteByEmailCard
          org={org}
          memberLimit={memberLimit}
          emailInput={emailInput}
          onEmailChange={setEmailInput}
          emailRole={emailRole}
          onRoleChange={setEmailRole}
          isSending={sendEmailInvite.isPending}
          onSend={() => sendEmailInvite.mutate(emailInput.trim())}
        />
      )}

      {members.isLoading ? (
        <TableSkeleton rows={4} />
      ) : (
        <Table fixed>
          <thead>
            <tr>
              <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} className="w-36" />
              <SortTh label="Email" sortKey="email" sort={sort} onSort={setSort} className="w-48" />
              <SortTh label="Role" sortKey="role" sort={sort} onSort={setSort} className="w-32" />
              <SortTh label="Joined" sortKey="createdAt" sort={sort} onSort={setSort} className="w-24" />
              {canManage && <Th className="w-16 text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.userId}>
                <Td className="truncate">{m.name}</Td>
                <Td className="truncate text-muted">{m.email}</Td>
                <Td>
                  {m.role === "owner" ? (
                    <MenuSelect
                      label="Owner"
                      value="owner"
                      disabled
                      onChange={() => {}}
                      options={[{ value: "owner", label: "owner" }]}
                    />
                  ) : canManage ? (
                    <MenuSelect
                      label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={(v) =>
                        setRole.mutate({
                          userId: m.userId,
                          role: v,
                        })
                      }
                      options={[
                        { value: "member", label: "member" },
                        { value: "admin", label: "admin" },
                      ]}
                    />
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
                          onClick={() => setRemoving({ userId: m.userId, name: m.name })}
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

      {canManage && !!invites.data?.length && (
        <Card className="mt-4">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
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

      {removing && (
        <RemoveMemberDialog
          member={removing}
          onClose={() => setRemoving(null)}
          remove={removeMember}
        />
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        role={inviteRole}
        onRoleChange={setInviteRole}
        onCreate={() => createInvite.mutate()}
        isCreating={createInvite.isPending}
      />
    </div>
  );
}

function InviteByEmailCard({
  org,
  memberLimit,
  emailInput,
  onEmailChange,
  emailRole,
  onRoleChange,
  isSending,
  onSend,
}: {
  org: NonNullable<ReturnType<typeof useCurrentOrg>["org"]>;
  memberLimit: number;
  emailInput: string;
  onEmailChange: (v: string) => void;
  emailRole: string;
  onRoleChange: (v: "member" | "admin") => void;
  isSending: boolean;
  onSend: () => void;
}) {
  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-1.5">
        <p className="text-2xs tracking-wider text-muted uppercase">
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
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="teammate@company.com"
            />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Role">
            <Select
              value={emailRole}
              onChange={(e) =>
                onRoleChange(e.target.value as "member" | "admin")
              }
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={isSending || !emailInput.trim()}
          onClick={onSend}
        >
          {isSending ? <Spinner /> : "Send invite"}
        </Button>
      </div>
    </Card>
  );
}
