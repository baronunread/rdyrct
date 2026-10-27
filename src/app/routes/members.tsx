import { useState, useMemo } from "react";
import { type InvitableRole } from "@/shared/types";
import { useCurrentOrg } from "../lib/current-org";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Ellipsis, Trash2, UserPlus } from "@/app/ui/icons";
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
import { Menu, MenuItem, MenuNote, MenuSeparator } from "../ui/menu";
import { RemoveMemberDialog } from "../components/member-dialogs";
import { InvitePeopleDialog, ROLE_OPTIONS } from "../components/invite-people-dialog";
import { Table, Th, Td, Card, PageHeader } from "../ui/misc";
import { HrefLink } from "../lib/router-search";
import { buttonClass } from "../ui/button-class";
import { TableSkeleton } from "../ui/skeleton";
import { MembersSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { copyToClipboard } from "../lib/clipboard";
import { SortTh } from "../ui/sort-th";
import { sortRows } from "../lib/sort";
import { withErrorToast } from "../lib/mutation-toast";
import { shortDate } from "../lib/dates";
import posthog from "../lib/posthog";

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
} satisfies Record<OrgRole, string>;

const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

function useMemberManagement(orgId: string, canManage: boolean) {
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(orgId);
  const invites = useInvites(orgId, canManage);
  const [inviteOpen, setInviteOpen] = useState(false);
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
    mutationFn: (role: InvitableRole) =>
      api<{ invites: InviteDTO[] }>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role },
      }),
    onSuccess: ({ invites }, role) => {
      posthog.capture("member_invited", { invite_type: "link", role });
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

/** The person in two lines (rdyrct-design, "Tables earn two lines"): the
 * name in bold over the address in mono. */
function PersonCell({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-semibold" title={title}>
        {title}
      </span>
      <span className="truncate font-mono text-xs text-muted" title={detail}>
        {detail}
      </span>
    </div>
  );
}

const menuTrigger = (
  <div className="flex justify-end">
    <span className="grid size-8 place-items-center rounded-md text-muted active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text">
      <Ellipsis size={16} />
    </span>
  </div>
);

/** Role change and removal for one member. The owner's row has none: the
 * owner is not chosen here, and nobody removes them. */
function MemberMenu({
  member,
  isSelf,
  onSetRole,
  onRemove,
}: {
  member: MemberDTO;
  isSelf: boolean;
  onSetRole: (role: string) => void;
  onRemove: () => void;
}) {
  if (member.role === "owner") return null;
  return (
    <Menu align="end" label={`Actions for ${member.name}`} trigger={menuTrigger}>
      <MenuNote>Role</MenuNote>
      {ROLE_OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          onClick={() => {
            if (o.value !== member.role) onSetRole(o.value);
          }}
        >
          <span className="w-4">
            {o.value === member.role && <Check size={13} className="text-accent" />}
          </span>
          {o.label}
        </MenuItem>
      ))}
      {!isSelf && (
        <>
          <MenuSeparator />
          <MenuItem className="text-danger" onClick={onRemove}>
            <Trash2 size={14} /> Remove {member.name}
          </MenuItem>
        </>
      )}
    </Menu>
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
      <Td>
        <PersonCell title={member.name} detail={member.email} />
      </Td>
      <Td className="text-sm">{ROLE_LABEL[member.role]}</Td>
      <Td className="tnum hidden text-sm whitespace-nowrap text-muted sm:table-cell">
        {shortDate(member.createdAt)}
      </Td>
      {canManage && (
        <Td className="py-1.5">
          <MemberMenu member={member} isSelf={isSelf} onSetRole={onSetRole} onRemove={onRemove} />
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
          <SortTh label="Person" sortKey="name" sort={sort} onSort={setSort} />
          <SortTh label="Role" sortKey="role" sort={sort} onSort={setSort} className="w-28" />
          <SortTh
            label="Joined"
            sortKey="createdAt"
            sort={sort}
            onSort={setSort}
            className="hidden sm:table-cell sm:w-32"
          />
          {canManage && (
            <Th className="w-14">
              <span className="sr-only">Actions</span>
            </Th>
          )}
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

function InviteRow({
  invite,
  copyInvite,
  onRevoke,
}: {
  invite: InviteDTO;
  copyInvite: (text: string) => Promise<void>;
  onRevoke: () => void;
}) {
  return (
    <tr>
      <Td>
        {invite.email ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-mono text-sm" title={invite.email}>
              {invite.email}
            </span>
            <span className="text-xs text-muted">Invited, not joined</span>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm">Invite link</span>
            <span className="text-xs text-muted">Single use, not opened yet</span>
          </div>
        )}
      </Td>
      <Td className="text-sm text-muted">{ROLE_LABEL[invite.role]}</Td>
      <Td className="tnum hidden text-sm whitespace-nowrap text-muted sm:table-cell">
        Expires {shortDate(invite.expiresAt)}
      </Td>
      <Td className="py-1.5">
        <div className="flex justify-end gap-1">
          <CopyButton text={inviteUrl(invite.token)} label="Copy invite link" onCopy={copyInvite} />
          <IconButton label="Revoke invite" danger onClick={onRevoke}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </Td>
    </tr>
  );
}

function PendingInvitesTable({
  invites,
  copyInvite,
  revokeInvite,
}: {
  invites: InviteDTO[];
  copyInvite: (text: string) => Promise<void>;
  revokeInvite: { mutate: (token: string) => void };
}) {
  return (
    <section className="mt-8 flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted">Pending invites</h2>
      <Table fixed>
        <thead>
          <tr>
            <Th>Invite</Th>
            <Th className="w-28">Role</Th>
            <Th className="hidden sm:table-cell sm:w-32">Expires</Th>
            <Th className="w-24">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {invites.map((inv) => (
            <InviteRow
              key={inv.token}
              invite={inv}
              copyInvite={copyInvite}
              onRevoke={() => revokeInvite.mutate(inv.token)}
            />
          ))}
        </tbody>
      </Table>
    </section>
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

/** The seat count under the title. A self-hosted instance has no limit to
 * count against, so it counts people instead. */
function seatLine(org: UserOrg, canManage: boolean, seats: SeatSummary, members: number): string {
  if (org.plan === "unlimited" || !canManage) {
    return members === 1 ? "1 person" : `${members.toLocaleString("en-US")} people`;
  }
  const line = `${seats.taken} of ${seats.limit} seats on your plan`;
  return seats.taken > seats.limit ? `${line} (over the limit)` : line;
}

function MembersHeader({
  org,
  canManage,
  seats,
  memberCount,
  onInvite,
}: {
  org: UserOrg;
  canManage: boolean;
  seats: SeatSummary;
  memberCount: number;
  onInvite: () => void;
}) {
  const action = canManage ? (
    <Button
      variant="primary"
      onClick={onInvite}
      disabled={seats.left === 0}
      title={seats.left === 0 ? fullSeatsHint(org, seats.limit) : undefined}
    >
      <UserPlus size={15} /> Invite people
    </Button>
  ) : undefined;
  return (
    <PageHeader
      title="Members"
      sub={<span className="tnum">{seatLine(org, canManage, seats, memberCount)}</span>}
      action={action}
    />
  );
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
    <PendingInvitesTable
      invites={invites ?? []}
      copyInvite={management.copyInvite}
      revokeInvite={management.revokeInvite}
    />
  );
}

function MemberOverlays({
  org,
  seats,
  management,
}: {
  org: UserOrg;
  seats: SeatSummary;
  management: MemberManagement;
}) {
  return (
    <>
      {management.removing && (
        <RemoveMemberDialog
          member={management.removing}
          onClose={() => management.setRemoving(null)}
          remove={management.removeMember}
        />
      )}
      <InvitePeopleDialog
        open={management.inviteOpen}
        onOpenChange={management.setInviteOpen}
        org={org}
        seats={seats}
        sendEmailInvite={management.sendEmailInvite}
        createInvite={management.createInvite}
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
        memberCount={rowCount(management.members.data)}
        onInvite={() => management.setInviteOpen(true)}
      />

      {canManage && seats.left === 0 && (
        <SeatsFullNotice org={org} memberLimit={seats.limit} over={seats.taken > seats.limit} />
      )}

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

      {canManage && <MemberOverlays org={org} seats={seats} management={management} />}
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

/** What stands in for the invite button once every seat is taken. Says
 * which of the two situations it is, because "full" and "over" need
 * different things done about them. */
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
