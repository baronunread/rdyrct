import { useState, useMemo, type ReactNode } from "react";
import { INVITABLE_ROLES, type InvitableRole } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { useCurrentOrg } from "../lib/current-org";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { IconUsers } from "@tabler/icons-react";
import { Check, ChevronsUpDown, Copy, Link, Plus, Trash2 } from "@/app/ui/icons";
import { invitesQuery, membersQuery, useCurrentUser, useMembers, useInvites } from "../lib/hooks";
import { settle, type PageContext } from "../lib/route-preload";
import { api } from "../lib/api";
import {
  PLAN_LIMITS,
  type InviteDTO,
  type InvitesCreated,
  type MemberDTO,
  type CurrentUser,
  type OrgRole,
  type Sort,
  type UserOrg,
} from "@/shared/types";
import { IconButton } from "../ui/button";
import { Menu, MenuItem, MenuNote, MenuSeparator } from "../ui/menu";
import { RemoveMemberDialog } from "../components/member-dialogs";
import { InvitePeopleDialog, type EmailInvites } from "../components/invite-people-dialog";
import { ROLE_OPTIONS } from "../lib/members-data";
import { SplitButton } from "../components/split-button";
import { UserAvatar } from "../components/user-avatar";
import { Table, Th, Td, PageHeader } from "../ui/misc";
import { HrefLink } from "../lib/router-search";
import { TableSkeleton } from "../ui/skeleton";
import { MembersSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { copyToClipboard } from "../lib/clipboard";
import { SortTh } from "../ui/sort-th";
import { sortRows } from "../lib/sort";
import { withErrorToast } from "../lib/mutation-toast";
import { shortDate } from "../lib/dates";
import { ROLE_LABEL, expiresLabel, lastActiveLabel, type InviteRowData } from "../lib/members-data";
import posthog from "../lib/posthog";

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

  const copyInvite = (text: string) =>
    copyToClipboard(text, toast, {
      success: "Invite link copied",
      error: "Could not copy invite link",
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

  const sendEmailInvites = useMutation({
    mutationFn: (params: EmailInvites) =>
      api<InvitesCreated>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: params.role, emails: params.emails },
      }),
    onSuccess: (_data, variables) => {
      posthog.capture("member_invited", {
        invite_type: "email",
        role: variables.role,
        count: variables.emails.length,
      });
      invalidateInvites();
    },
    onError: withErrorToast(toast),
  });

  const revokeInvite = useMutation({
    mutationFn: (token: string) => api(`/orgs/${orgId}/invites/${token}`, { method: "DELETE" }),
    onSuccess: invalidateInvites,
    onError: withErrorToast(toast),
  });

  const sorted = useMemo(
    () =>
      sortRows<MemberDTO>(members.data ?? [], sort, {
        name: (m) => m.name.toLowerCase(),
        role: (m) => m.role,
        lastActiveAt: (m) => m.lastActiveAt,
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
    sendEmailInvites,
    revokeInvite,
    copyInvite,
  };
}

/** The person in two lines beside their picture (rdyrct-design, "Tables
 * earn two lines"): the name in bold over the address in mono. */
function PersonCell({
  title,
  detail,
  avatar,
}: {
  title: string;
  detail: string;
  avatar: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatar}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <span className="truncate font-mono text-xs text-muted" title={detail}>
          {detail}
        </span>
      </div>
    </div>
  );
}

/** Somebody who has not joined yet: an empty, dashed place where their
 * picture will be. */
function PendingAvatar() {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full text-muted outline-[1.5px] outline-offset-[-1.5px] outline-border outline-dashed"
    >
      <IconUsers size={14} stroke={1.75} />
    </span>
  );
}

/** The look of an inline select: plain text at rest, a lifted field on
 * hover or when open, so a table of roles reads as a list and not a form. */
const roleFace =
  "flex h-8 max-sm:h-10 min-w-[6.5rem] items-center justify-between gap-1.5 rounded-[7px] pr-2 pl-2.5 text-sm transition-[background-color,box-shadow] duration-150 [@media(hover:hover)]:group-hover/role:bg-surface [@media(hover:hover)]:group-hover/role:smooth-shadow-ring-xs";

/** The role, changed where it is shown. The owner's row has none: the
 * owner is not chosen here. On a phone, with no column for the trash, the
 * same menu is also where a member is removed. */
function RoleSelect({
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
  return (
    <div className="group/role inline-block">
      <Menu
        label={`Change role for ${member.name}`}
        trigger={
          <span className={roleFace}>
            {ROLE_LABEL[member.role]}
            <ChevronsUpDown size={13} className="shrink-0 text-muted" aria-hidden />
          </span>
        }
      >
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
    </div>
  );
}

/** Row actions that appear on hover where there is hover, and stay put on
 * a touch screen, which has none. */
const rowActions =
  "flex justify-end gap-0.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-within:opacity-100";

type Columns = { actions: boolean };

function MemberRow({
  member,
  columns,
  canManage,
  isSelf,
  onSetRole,
  onRemove,
}: {
  member: MemberDTO;
  columns: Columns;
  canManage: boolean;
  isSelf: boolean;
  onSetRole: (role: string) => void;
  onRemove: () => void;
}) {
  const editable = canManage && member.role !== "owner";
  return (
    <tr className="group/row">
      <Td className="py-3">
        <PersonCell
          title={member.name}
          detail={member.email}
          avatar={
            <UserAvatar
              user={{
                id: member.userId,
                image: member.image ?? null,
                name: member.name,
                email: member.email,
              }}
              size={32}
            />
          }
        />
      </Td>
      <Td className="py-2">
        {editable ? (
          <RoleSelect member={member} isSelf={isSelf} onSetRole={onSetRole} onRemove={onRemove} />
        ) : (
          <span className="pl-2.5 text-sm text-muted">{ROLE_LABEL[member.role]}</span>
        )}
      </Td>
      <Td className="tnum hidden text-sm whitespace-nowrap text-muted sm:table-cell">
        <LastActive ts={member.lastActiveAt} />
      </Td>
      <Td className="tnum hidden text-sm whitespace-nowrap text-muted sm:table-cell">
        {shortDate(member.createdAt)}
      </Td>
      {columns.actions && (
        <Td className="hidden py-1.5 sm:table-cell">
          {editable && !isSelf && (
            <div className={rowActions}>
              <IconButton label={`Remove ${member.name}`} danger onClick={onRemove}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          )}
        </Td>
      )}
    </tr>
  );
}

function LastActive({ ts }: { ts: number | null }) {
  const label = lastActiveLabel(ts);
  if (label === "Online now")
    return (
      <span className="inline-flex items-center gap-1.5 text-text">
        <span aria-hidden className="size-1.5 rounded-full bg-accent-2" />
        {label}
      </span>
    );
  return <>{label}</>;
}

/** An invite nobody has accepted yet, in the same table as the people it
 * will become: who it went to, the role it gives, and when it runs out. */
function InviteRow({
  invite,
  columns,
  copyInvite,
  onRevoke,
}: {
  invite: InviteRowData;
  columns: Columns;
  copyInvite: (text: string) => Promise<void>;
  onRevoke: () => void;
}) {
  const url = inviteUrl(invite.token);
  const copy = () => void copyInvite(url).catch(() => {});
  return (
    <tr className="text-muted">
      <Td className="py-3">
        <PersonCell
          title={invite.email ? "Invited" : "Invite link"}
          detail={invite.email ?? "Single use, not opened yet"}
          avatar={<PendingAvatar />}
        />
      </Td>
      <Td className="py-2">
        {/* A phone has no actions column: the role opens them instead. */}
        <span className="hidden pl-2.5 text-sm sm:inline">{ROLE_LABEL[invite.role]}</span>
        <div className="group/role inline-block sm:hidden">
          <Menu
            label={`Invite actions for ${invite.email ?? "invite link"}`}
            trigger={
              <span className={roleFace}>
                {ROLE_LABEL[invite.role]}
                <ChevronsUpDown size={13} className="shrink-0 text-muted" aria-hidden />
              </span>
            }
          >
            <MenuNote>Invite sent. {expiresLabel(invite.expiresAt)}.</MenuNote>
            <MenuItem onClick={copy}>
              <Copy size={14} /> Copy invite link
            </MenuItem>
            <MenuSeparator />
            <MenuItem className="text-danger" onClick={onRevoke}>
              <Trash2 size={14} /> Revoke invite
            </MenuItem>
          </Menu>
        </div>
      </Td>
      <Td className="hidden text-sm whitespace-nowrap sm:table-cell">Not yet</Td>
      <Td className="hidden whitespace-nowrap sm:table-cell">
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-sm text-text">
            <span aria-hidden className="size-1.5 rounded-full bg-butter" />
            {invite.email ? "Invite sent" : "Link made"}
          </span>
          <span className="text-xs tnum">{expiresLabel(invite.expiresAt)}</span>
        </div>
      </Td>
      {columns.actions && (
        <Td className="hidden py-1.5 sm:table-cell">
          <div className="flex justify-end gap-0.5">
            <IconButton label="Copy invite link" onClick={copy}>
              <Copy size={15} />
            </IconButton>
            <IconButton label="Revoke invite" danger onClick={onRevoke}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        </Td>
      )}
    </tr>
  );
}

function MemberTable({
  management,
  canManage,
  meId,
}: {
  management: MemberManagement;
  canManage: boolean;
  meId: string | undefined;
}) {
  const { sorted, sort, setSort } = management;
  const invites: InviteRowData[] = canManage ? (management.invites.data ?? []) : [];
  if (management.members.isLoading) return <TableSkeleton rows={4} />;
  const columns: Columns = { actions: canManage };
  return (
    <Table fixed>
      <thead>
        <tr>
          <SortTh label="Person" sortKey="name" sort={sort} onSort={setSort} />
          <SortTh
            label="Role"
            sortKey="role"
            sort={sort}
            onSort={setSort}
            className="w-32 sm:w-36"
          />
          <SortTh
            label="Last active"
            sortKey="lastActiveAt"
            sort={sort}
            onSort={setSort}
            className="hidden sm:table-cell sm:w-36"
          />
          <SortTh
            label="Joined"
            sortKey="createdAt"
            sort={sort}
            onSort={setSort}
            className="hidden sm:table-cell sm:w-36"
          />
          {columns.actions && (
            <Th className="hidden sm:table-cell sm:w-24">
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
            columns={columns}
            canManage={canManage}
            isSelf={m.userId === meId}
            onSetRole={(role) => management.setRole.mutate({ userId: m.userId, role })}
            onRemove={() => management.setRemoving({ userId: m.userId, name: m.name })}
          />
        ))}
        {/* Not sorted with the people: an invite has no name, no role
            history and no join date, so it would only scatter them. */}
        {invites.map((inv) => (
          <InviteRow
            key={inv.token}
            invite={inv}
            columns={columns}
            copyInvite={management.copyInvite}
            onRevoke={() => management.revokeInvite.mutate(inv.token)}
          />
        ))}
      </tbody>
    </Table>
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

function canManageOrg(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

type MemberManagement = ReturnType<typeof useMemberManagement>;
type SeatSummary = { limit: number; taken: number; left: number };

function rowCount(rows: readonly object[] | undefined): number {
  return rows ? rows.length : 0;
}

function seatSummary(org: UserOrg, management: MemberManagement): SeatSummary {
  const limit = org ? PLAN_LIMITS[org.plan].members : 0;
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
  const line = `${seats.taken} of ${seats.limit} on your plan`;
  return seats.taken > seats.limit ? `${line} (over the limit)` : line;
}

/** "Invite" opens the dialog; the chevron makes a link straight away, for
 * whichever role, without the dialog in between. */
function InviteButton({
  org,
  seats,
  management,
}: {
  org: UserOrg;
  seats: SeatSummary;
  management: MemberManagement;
}) {
  return (
    <SplitButton
      onClick={() => management.setInviteOpen(true)}
      disabled={seats.left === 0}
      title={fullSeatsHint(org, seats.limit)}
      menuLabel="More ways to invite"
      menu={
        <>
          <MenuItem onClick={() => management.setInviteOpen(true)}>
            <Plus size={14} className="text-muted" /> Invite by email
          </MenuItem>
          <MenuSeparator />
          <MenuNote>Copy a single-use invite link for a</MenuNote>
          {ROLE_OPTIONS.map((o) => (
            <MenuItem
              key={o.value}
              disabled={management.createInvite.isPending}
              onClick={() =>
                management.createInvite.mutate(oneOf(INVITABLE_ROLES, o.value, "member"))
              }
            >
              <Link size={14} className="text-muted" /> {o.label}
            </MenuItem>
          ))}
        </>
      }
    >
      <Plus size={15} aria-hidden /> Invite
    </SplitButton>
  );
}

function MembersHeader({
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
  return (
    <PageHeader
      title="Members"
      sub={
        <span className="tnum">
          {seatLine(org, canManage, seats, rowCount(management.members.data))}
        </span>
      }
      action={
        canManage ? <InviteButton org={org} seats={seats} management={management} /> : undefined
      }
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
        sendEmailInvites={management.sendEmailInvites}
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
    <div className="flex flex-col">
      <MembersHeader org={org} canManage={canManage} seats={seats} management={management} />

      {canManage && seats.left === 0 && (
        <SeatsFullNotice org={org} memberLimit={seats.limit} over={seats.taken > seats.limit} />
      )}

      <MemberTable management={management} canManage={canManage} meId={userId} />

      <p className="mt-3 text-xs text-pretty text-muted">
        Roles: Admins manage links, domains and members. Members create and edit links. Viewers see
        links and analytics.
      </p>

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

/** Everything the members page's first frame reads (see
 * lib/route-preload.ts): the roster, and open invites for whoever manages it. */
export function preload(qc: QueryClient, orgId: string, { org, user }: PageContext) {
  return settle([
    qc.ensureQueryData(membersQuery(orgId)),
    memberCanManage(org, user) ? qc.ensureQueryData(invitesQuery(orgId)) : undefined,
  ]);
}

export function MembersPage() {
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();
  // A locked org accepts no writes from anyone, its owner included (#160).
  const canManage = memberCanManage(org, currentUser.data);
  const management = useMemberManagement(org ? org.id : "", canManage);

  // A cached shell is not permission to invite or change a role. Keep the
  // route's whole shape in place until /user gives the current answer.
  if (currentUser.isLoading) return <MembersSkeleton />;
  if (!org) return <NoOrgState />;
  return (
    <MembersView
      org={org}
      userId={currentUser.data?.user.id}
      canManage={canManage}
      seats={seatSummary(org, management)}
      management={management}
    />
  );
}

/** Why the Invite button is greyed out once every seat is taken, and the
 * way out. A line under the title, not a card: when the org is over its
 * plan the notice above the page already carries the facts, and one notice
 * is the rule. Says which of the two situations it is, because "full" and
 * "over" need different things done about them. */
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
    <p className="-mt-3 mb-4 max-w-prose text-xs text-pretty text-muted">
      {over
        ? `This organization has more people or open invites than the ${org.plan} plan allows (${memberLimit}). Nobody was removed. Remove a member or revoke an invite to make room, or upgrade to keep everyone. `
        : `Every seat on the ${org.plan} plan is taken (${memberLimit}, counting open invites). Remove someone, or upgrade to invite more. `}
      <HrefLink href="/billing" className="text-accent underline-offset-2 hover:underline">
        See plans
      </HrefLink>
    </p>
  );
}

/** The tooltip on a disabled invite control. */
function fullSeatsHint(org: UserOrg, memberLimit: number): string {
  return `The ${org.plan} plan allows ${memberLimit} members, counting open invites`;
}
