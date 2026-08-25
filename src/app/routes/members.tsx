import { useState, useMemo, useCallback } from "react";
import { type InvitableRole, INVITABLE_ROLES } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useCurrentOrg } from "../lib/current-org";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Trash2, Info } from "lucide-react";
import { useCurrentUser, useMembers, useInvites } from "../lib/hooks";
import { api } from "../lib/api";
import {
  PLAN_LIMITS,
  type InviteDTO,
  type MemberDTO,
  type CurrentUser,
  type OrgRole,
  type Sort,
  type UserOrg,
} from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { RemoveMemberDialog, InviteMemberDialog } from "../components/member-dialogs";
import { Table, Th, Td, Badge, Card, PageHeader } from "../ui/misc";
import { HrefLink } from "../lib/router-search";
import { buttonClass } from "../ui/button-class";
import { TableSkeleton } from "../ui/skeleton";
import { MembersSkeleton } from "../components/skeletons";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { copyToClipboard } from "../lib/clipboard";
import { SortTh } from "../ui/sort-th";
import { sortRows } from "../lib/sort";
import { withErrorToast } from "../lib/mutation-toast";
import { shortDate } from "../lib/dates";
import { inviteEmailSchema } from "../lib/schemas";
import posthog from "../lib/posthog";

const roleColor = {
  owner: "accent",
  admin: "mint",
  member: "muted",
  viewer: "muted",
} satisfies Record<OrgRole, "accent" | "mint" | "muted">;

/** What each role can do, said once, where the role is chosen. Without it
 * "viewer" and "member" look like the same word twice. */
const ROLE_OPTIONS = [
  { value: "viewer", label: "viewer" },
  { value: "member", label: "member" },
  { value: "admin", label: "admin" },
];

const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

function useMemberManagement(orgId: string, canManage: boolean) {
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(orgId);
  const invites = useInvites(orgId, canManage);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<InvitableRole>("member");
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: 1 });

  const invalidateMembers = () => qc.invalidateQueries({ queryKey: ["members", orgId] });
  const invalidateInvites = () => qc.invalidateQueries({ queryKey: ["invites", orgId] });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api(`/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: { role } }),
    onSuccess: invalidateMembers,
    onError: withErrorToast(toast),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: invalidateMembers,
    onError: withErrorToast(toast),
  });

  const createInvite = useMutation({
    mutationFn: () =>
      api<{ invites: InviteDTO[] }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: inviteRole },
      }),
    onSuccess: ({ invites }) => {
      posthog.capture("member_invited", { invite_type: "link", role: inviteRole });
      invalidateInvites();
      const invite = invites[0];
      if (invite) {
        void copyInvite(inviteUrl(invite.token)).catch(() => {});
      }
      setInviteOpen(false);
    },
    onError: withErrorToast(toast),
  });

  const sendEmailInvite = useMutation({
    mutationFn: (params: { email: string; role: InvitableRole }) =>
      api<{ invites: InviteDTO[] }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: params.role, emails: [params.email] },
      }),
    onSuccess: (_data, variables) => {
      posthog.capture("member_invited", { invite_type: "email", role: variables.role });
      invalidateInvites();
    },
    onError: withErrorToast(toast),
  });

  const revokeInvite = useMutation({
    mutationFn: (token: string) => api(`/orgs/${orgId}/invites/${token}`, { method: "DELETE" }),
    onSuccess: invalidateInvites,
    onError: withErrorToast(toast),
  });

  const copyInvite = (text: string) =>
    copyToClipboard(text, toast, {
      success: "Invite link copied",
      error: "Could not copy invite link",
    });

  const sorted = useMemo(
    () =>
      sortRows(members.data ?? [], sort, {
        name: (m) => m.name.toLowerCase(),
        email: (m) => m.email.toLowerCase(),
        role: (m) => m.role,
        createdAt: (m) => m.createdAt,
      }),
    [members.data, sort],
  );

  return {
    members,
    invites,
    inviteOpen,
    setInviteOpen,
    inviteRole,
    setInviteRole,
    removing,
    setRemoving,
    sort,
    setSort,
    sorted,
    setRole,
    removeMember,
    createInvite,
    sendEmailInvite,
    revokeInvite,
    inviteUrl,
    copyInvite,
  };
}

function MemberRoleCell({
  member,
  canManage,
  onSetRole,
}: {
  member: { name: string; role: OrgRole; demoted: boolean };
  canManage: boolean;
  onSetRole: (role: string) => void;
}) {
  if (member.role === "owner") {
    return (
      <MenuSelect
        label="Owner"
        value="owner"
        disabled
        onChange={() => {}}
        options={[{ value: "owner", label: "owner" }]}
      />
    );
  }
  if (canManage) {
    return (
      <MenuSelect
        label={`Role for ${member.name}`}
        value={member.role}
        onChange={onSetRole}
        options={ROLE_OPTIONS}
      />
    );
  }
  return <Badge color={roleColor[member.role]}>{member.role}</Badge>;
}

function MemberRemoveCell({
  member,
  isSelf,
  onRemove,
}: {
  member: { name: string; role: OrgRole };
  isSelf: boolean;
  onRemove: () => void;
}) {
  if (member.role === "owner" || isSelf) return null;
  return (
    <div className="flex justify-end">
      <IconButton label={`Remove ${member.name}`} danger onClick={onRemove}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  isSelf,
  onSetRole,
  onRemove,
}: {
  member: MemberDTO;
  canManage: boolean;
  isSelf: boolean;
  onSetRole: (role: string) => void;
  onRemove: () => void;
}) {
  return (
    <tr>
      <Td className="truncate">{member.name}</Td>
      <Td className="truncate text-muted">{member.email}</Td>
      <Td>
        <MemberRoleCell member={member} canManage={canManage} onSetRole={onSetRole} />
      </Td>
      <Td className="text-xs text-muted">{shortDate(member.createdAt)}</Td>
      {canManage && (
        <Td>
          <MemberRemoveCell member={member} isSelf={isSelf} onRemove={onRemove} />
        </Td>
      )}
    </tr>
  );
}

function MemberTable({
  isLoading,
  sorted,
  canManage,
  sort,
  setSort,
  meId,
  onSetRole,
  onRemove,
}: {
  isLoading: boolean;
  sorted: MemberDTO[];
  canManage: boolean;
  sort: Sort;
  setSort: (s: Sort) => void;
  meId: string | undefined;
  onSetRole: (userId: string, role: string) => void;
  onRemove: (userId: string, name: string) => void;
}) {
  if (isLoading) return <TableSkeleton rows={4} />;
  return (
    <Table fixed>
      <thead>
        <tr>
          <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} className="w-36" />
          <SortTh label="Email" sortKey="email" sort={sort} onSort={setSort} className="w-48" />
          <SortTh label="Role" sortKey="role" sort={sort} onSort={setSort} className="w-32" />
          <SortTh
            label="Joined"
            sortKey="createdAt"
            sort={sort}
            onSort={setSort}
            className="w-24"
          />
          {canManage && <Th className="w-16 text-right">Actions</Th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            canManage={canManage}
            isSelf={m.userId === meId}
            onSetRole={(role) => onSetRole(m.userId, role)}
            onRemove={() => onRemove(m.userId, m.name)}
          />
        ))}
      </tbody>
    </Table>
  );
}

function PendingInvitesCard({
  invites,
  inviteUrl,
  copyInvite,
  revokeInvite,
}: {
  invites: InviteDTO[];
  inviteUrl: (token: string) => string;
  copyInvite: (text: string) => Promise<void>;
  revokeInvite: { mutate: (token: string) => void };
}) {
  return (
    <Card className="mt-4">
      <p className="mb-3 text-xs font-medium text-muted">Pending invites</p>
      <ul className="flex flex-col gap-2">
        {invites.map((inv) => (
          <li key={inv.token} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-muted">{inv.email ?? "link invite"}</span>
            <span className="flex items-center gap-2">
              <Badge color={inv.role === "admin" ? "mint" : "muted"}>{inv.role}</Badge>
              <span className="text-xs text-muted">expires {shortDate(inv.expiresAt)}</span>
              <CopyButton
                text={inviteUrl(inv.token)}
                label="Copy invite link"
                onCopy={copyInvite}
              />
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
  );
}

/** Platform admins act as owner everywhere; otherwise fall back to the
 * caller's actual role in this org, or "member" while org/role is unknown. */
function resolveMyRole(
  isPlatformAdmin: boolean | undefined,
  orgRole: OrgRole | undefined,
): OrgRole {
  if (isPlatformAdmin) return "owner";
  return orgRole ?? "member";
}

function memberLimitFor(org: UserOrg | null): number {
  return org ? PLAN_LIMITS[org.plan].members : 0;
}

function hasPendingInvites(invites: InviteDTO[] | undefined): boolean {
  return (invites?.length ?? 0) > 0;
}

function canManageOrg(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

type MemberManagement = ReturnType<typeof useMemberManagement>;
type SeatSummary = { limit: number; taken: number; left: number };

function rowCount(rows: readonly object[] | undefined): number {
  return rows ? rows.length : 0;
}

function seatSummary(org: UserOrg, management: MemberManagement): SeatSummary {
  const limit = memberLimitFor(org);
  // An org at or over its cap cannot take another member: the server refuses
  // the invite with a 402, so offering the form is offering an error (#161).
  // Counted from the same figure the server uses, members plus open invites.
  const taken = rowCount(management.members.data) + rowCount(management.invites.data);
  return { limit, taken, left: Math.max(0, limit - taken) };
}

function MembersHeader({
  org,
  canManage,
  seats,
  onInvite,
}: {
  org: UserOrg;
  canManage: boolean;
  seats: SeatSummary;
  onInvite: () => void;
}) {
  const action = canManage ? (
    <div className="flex items-center gap-3">
      <span className="tnum text-xs text-muted">
        {seats.taken} / {seats.limit} members
        {seats.taken > seats.limit && " (over the limit)"}
      </span>
      <Button
        variant="primary"
        onClick={onInvite}
        disabled={seats.left === 0}
        title={seats.left === 0 ? fullSeatsHint(org, seats.limit) : undefined}
      >
        <UserPlus size={15} /> Invite link
      </Button>
    </div>
  ) : undefined;
  return (
    <PageHeader title="Members" sub="People with access to this organization" action={action} />
  );
}

function MemberInviteSection({
  org,
  seats,
  management,
}: {
  org: UserOrg;
  seats: SeatSummary;
  management: MemberManagement;
}) {
  if (seats.left === 0) {
    return <SeatsFullNotice org={org} memberLimit={seats.limit} over={seats.taken > seats.limit} />;
  }
  return (
    <InviteByEmailCard
      org={org}
      memberLimit={seats.limit}
      sendEmailInvite={management.sendEmailInvite}
    />
  );
}

function ManagedInviteSection({
  org,
  canManage,
  seats,
  management,
}: {
  org: UserOrg;
  canManage: boolean;
  seats: SeatSummary;
  management: MemberManagement;
}) {
  if (!canManage) return null;
  return <MemberInviteSection org={org} seats={seats} management={management} />;
}

function PendingInvitesSection({
  canManage,
  management,
}: {
  canManage: boolean;
  management: MemberManagement;
}) {
  const invites = management.invites.data;
  if (!canManage || !hasPendingInvites(invites)) return null;
  return (
    <PendingInvitesCard
      invites={invites ?? []}
      inviteUrl={management.inviteUrl}
      copyInvite={management.copyInvite}
      revokeInvite={management.revokeInvite}
    />
  );
}

function MemberOverlays({ management }: { management: MemberManagement }) {
  return (
    <>
      {management.removing && (
        <RemoveMemberDialog
          member={management.removing}
          onClose={() => management.setRemoving(null)}
          remove={management.removeMember}
        />
      )}
      <InviteMemberDialog
        open={management.inviteOpen}
        onOpenChange={management.setInviteOpen}
        role={management.inviteRole}
        onRoleChange={management.setInviteRole}
        onCreate={() => management.createInvite.mutate()}
        isCreating={management.createInvite.isPending}
      />
    </>
  );
}

function MembersView({
  org,
  userId,
  canManage,
  seats,
  management,
}: {
  org: UserOrg;
  userId: string | undefined;
  canManage: boolean;
  seats: SeatSummary;
  management: MemberManagement;
}) {
  return (
    <div>
      <MembersHeader
        org={org}
        canManage={canManage}
        seats={seats}
        onInvite={() => management.setInviteOpen(true)}
      />

      <ManagedInviteSection org={org} canManage={canManage} seats={seats} management={management} />

      <MemberTable
        isLoading={management.members.isLoading}
        sorted={management.sorted}
        canManage={canManage}
        sort={management.sort}
        setSort={management.setSort}
        meId={userId}
        onSetRole={(memberId, role) => management.setRole.mutate({ userId: memberId, role })}
        onRemove={(memberId, name) => management.setRemoving({ userId: memberId, name })}
      />

      <PendingInvitesSection canManage={canManage} management={management} />

      <MemberOverlays management={management} />
    </div>
  );
}

function memberCanManage(
  org: UserOrg | null,
  currentUser: CurrentUser | null | undefined,
): boolean {
  if (!org) return false;
  const myRole = resolveMyRole(currentUser?.user.isAdmin, org.role);
  return canManageOrg(myRole) && !org.locked;
}

function memberOrgId(org: UserOrg | null): string {
  return org ? org.id : "";
}

function currentMemberId(currentUser: CurrentUser | null | undefined): string | undefined {
  return currentUser?.user.id;
}

export function MembersPage() {
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();
  // A locked org accepts no writes from anyone, its owner included (#160).
  const canManage = memberCanManage(org, currentUser.data);
  const management = useMemberManagement(memberOrgId(org), canManage);

  // A cached shell is not permission to invite or change a role. Keep the
  // route's whole shape in place until /user gives the current answer.
  if (currentUser.isLoading) return <MembersSkeleton />;
  if (!org) return <NoOrgState />;
  return (
    <MembersView
      org={org}
      userId={currentMemberId(currentUser.data)}
      canManage={canManage}
      seats={seatSummary(org, management)}
      management={management}
    />
  );
}

/** What the invite form is replaced by once every seat is taken. Says which
 * of the two situations it is, because "full" and "over" need different
 * things done about them. */
function SeatsFullNotice({
  org,
  memberLimit,
  over,
}: {
  org: UserOrg;
  memberLimit: number;
  over: boolean;
}) {
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">
          {over
            ? `This organization has more people or open invites than the ${org.plan} plan allows (${memberLimit}). Nobody was removed. Remove a member or revoke an invite to make room, or upgrade to keep everyone.`
            : `Every seat on the ${org.plan} plan is taken (${memberLimit}, counting open invites). Remove someone, or upgrade to invite more.`}
        </p>
        <HrefLink href="/billing" className={buttonClass({ variant: "outline", size: "sm" })}>
          See plans
        </HrefLink>
      </div>
    </Card>
  );
}

/** The tooltip on a disabled invite control. */
function fullSeatsHint(org: UserOrg, memberLimit: number): string {
  return `The ${org.plan} plan allows ${memberLimit} members, counting open invites`;
}

function InviteByEmailCard({
  org,
  memberLimit,
  sendEmailInvite,
}: {
  org: NonNullable<ReturnType<typeof useCurrentOrg>["org"]>;
  memberLimit: number;
  sendEmailInvite: {
    mutate: (
      params: { email: string; role: InvitableRole },
      opts?: { onSuccess?: () => void },
    ) => void;
    isPending: boolean;
  };
}) {
  const toast = useToast();
  const { register, handleSubmit, watch, setValue, reset } = useForm<{
    email: string;
    role: InvitableRole;
  }>({
    resolver: valibotResolver(inviteEmailSchema),
    defaultValues: { email: "", role: "member" },
  });
  const selectedRole = watch("role");

  const submit = useCallback(
    ({ email, role }: { email: string; role: InvitableRole }) => {
      sendEmailInvite.mutate(
        { email, role },
        {
          onSuccess: () => {
            reset({ email: "", role });
            toast("Invite sent");
          },
        },
      );
    },
    [sendEmailInvite, reset, toast],
  );

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-1.5">
        <p className="text-xs font-medium text-muted">Invite by email</p>
        <Tooltip
          content={
            <>
              You can invite up to {memberLimit} members on the {org.plan} plan. Pending invites
              count toward the limit.
            </>
          }
        >
          <button
            type="button"
            aria-label="Member limit info"
            className="cursor-help text-muted hover:text-text"
          >
            <Info size={13} />
          </button>
        </Tooltip>
      </div>
      <form
        onSubmit={handleSubmit(submit, (errors) =>
          toast(errors.email?.message ?? "Enter a valid email address", "error"),
        )}
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <Field label="Email">
            <Input type="email" {...register("email")} placeholder="teammate@company.com" />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Role">
            <MenuSelect
              label="Role"
              value={selectedRole}
              onChange={(role) => setValue("role", oneOf(INVITABLE_ROLES, role, "member"))}
              options={ROLE_OPTIONS}
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" disabled={sendEmailInvite.isPending}>
          <BusyContent busy={sendEmailInvite.isPending}>Send invite</BusyContent>
        </Button>
      </form>
    </Card>
  );
}
