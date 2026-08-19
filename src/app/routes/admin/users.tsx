import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Ellipsis, Trash2 } from "lucide-react";
import { ShieldMinus, ShieldPlus } from "lucide"; // icon nodes for MorphIcon
import { MorphIcon } from "morphicons/react";
import { useAdminUsers, useCurrentUser } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminUserRow, OrgPlan, Sort } from "@/shared/types";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, PageHeader, Table, Td, Th } from "../../ui/misc";
import { Tooltip } from "../../ui/tooltip";
import { AdminTableSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { paginate } from "./util";
import { SortTh } from "../../ui/sort-th";
import { withErrorToast } from "../../lib/mutation-toast";
import { sortRows } from "../../lib/sort";
import { shortDate } from "../../lib/dates";
import { lastSeenLabel } from "../../lib/last-seen";
import { Pager } from "../../ui/pagination";
import { GrantCompDialog, type CompPlan } from "./comp-dialog";

type UserAction = "delete" | "ban" | "unban" | "makeAdmin" | "removeAdmin";

/** What the confirmation dialog for one user action says. */
interface UserActionMeta {
  title: string;
  confirmLabel: string;
  danger: boolean;
  body: (u: AdminUserRow) => ReactNode;
}

const userActionMeta = {
  delete: {
    title: "Delete user",
    confirmLabel: "Delete user",
    danger: true,
    body: (u) => (
      <>
        Delete <span className="font-bold text-accent">{u.name}</span>? Their sessions, linked
        accounts, and org memberships are removed. Links and invites they created stay,
        unattributed. If they own any organization, delete that organization first. This cannot be
        undone.
      </>
    ),
  },
  ban: {
    title: "Ban user",
    confirmLabel: "Ban user",
    danger: true,
    body: (u) => (
      <>
        Ban <span className="font-bold text-accent">{u.name}</span>? They are signed out immediately
        and cannot sign back in. Their organizations, links, and QR codes keep working. You can
        unban them anytime.
      </>
    ),
  },
  unban: {
    title: "Unban user",
    confirmLabel: "Unban user",
    danger: false,
    body: (u) => (
      <>
        Unban <span className="font-bold text-accent">{u.name}</span>? They can sign in again right
        away.
      </>
    ),
  },
  makeAdmin: {
    title: "Make platform admin",
    confirmLabel: "Make platform admin",
    danger: false,
    body: (u) => (
      <>
        Make <span className="font-bold text-accent">{u.name}</span> a platform admin? They get full
        access to this admin area: every user, organization, and link on the instance.
      </>
    ),
  },
  removeAdmin: {
    title: "Remove platform admin",
    confirmLabel: "Remove platform admin",
    danger: true,
    body: (u) => (
      <>
        Remove <span className="font-bold text-accent">{u.name}</span>'s platform admin? They keep
        their organizations and links but lose access to this admin area.
      </>
    ),
  },
} satisfies Record<UserAction, UserActionMeta>;

const planBadgeColor = {
  pro: "mint",
  hobby: "accent",
  free: "muted",
} satisfies Record<OrgPlan, "mint" | "accent" | "muted">;

/** Where a user's paid access comes from, which is not the same question as
 * what it unlocks (#81). A comp outranks a subscription, so it is named
 * first. */
function BillingCell({ user }: { user: AdminUserRow }) {
  if (user.compPlan)
    return (
      <BillingBadge
        color="butter"
        label="comped"
        detail={[user.compReason ?? "No reason recorded.", user.compGrantedBy]
          .filter(Boolean)
          .join(" · ")}
      />
    );
  if (!user.subscriptionPlan)
    return (
      <BillingBadge color="muted" label="no sub" detail="No subscription: never paid for a plan." />
    );
  if (user.subscriptionStatus === "past_due")
    return (
      <BillingBadge
        color="pink"
        label="past due"
        detail="A payment is failing. Polar keeps retrying for days, so access stays until it gives up."
      />
    );
  // `subscriptionPlan` is the Polar snapshot, not a grant: `unpaid`,
  // `canceled` and anything Polar adds later leave the subscription on the row
  // while it entitles nothing. `plan` is derived from the status (#81), so a
  // free plan here means exactly that. Name the status instead of "paid".
  if (user.plan === "free")
    return (
      <BillingBadge
        color="muted"
        label={user.subscriptionStatus ?? "unknown"}
        detail="The subscription is on the row, and it grants nothing."
      />
    );
  // "cancels", not "cancelled": the subscription is still paid and still
  // entitles everything until the period ends. Polar only reports the status
  // as `canceled` once it is actually over, and that lands on the muted badge
  // above.
  if (user.cancelAtPeriodEnd)
    return (
      <BillingBadge
        color="pink"
        label="cancels"
        detail="Paid until the current period ends, then it stops. Nothing has been taken away yet."
      />
    );
  return (
    <BillingBadge color="mint" label="paid" detail="A live subscription pays for this plan." />
  );
}

/** One badge, and what it means on hover. The explanations are a sentence
 * each and some are free text an admin typed, so they hang off the badge
 * instead of setting the height of every row in the table. */
function BillingBadge({
  color,
  label,
  detail,
}: {
  color: "muted" | "mint" | "pink" | "butter";
  label: string;
  detail: string;
}) {
  return (
    <Tooltip content={detail}>
      <span className="inline-flex">
        <Badge color={color}>{label}</Badge>
      </span>
    </Tooltip>
  );
}

/** Grant, change, or revoke a comp. There is no "set plan": a plan an admin
 * writes by hand is a comp, and it is recorded as one. */
function CompMenuItems({
  user,
  onGrant,
  onRevoke,
}: {
  user: AdminUserRow;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onGrant}>
        <span className="w-3.5">
          {user.compPlan && <Check size={13} className="text-accent" />}
        </span>
        {user.compPlan ? `Change comp (${user.compPlan})` : "Comp a paid plan…"}
      </MenuItem>
      {user.compPlan && (
        <MenuItem onClick={onRevoke}>
          <span className="w-3.5" />
          Revoke comp
        </MenuItem>
      )}
    </>
  );
}

/** "Make/remove platform admin", hidden for your own row. */
function AdminToggleMenuItem({
  user,
  isSelf,
  onConfirm,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onConfirm: (kind: UserAction) => void;
}) {
  if (isSelf) return null;
  return (
    <MenuItem onClick={() => onConfirm(user.isAdmin ? "removeAdmin" : "makeAdmin")}>
      <MorphIcon icon={user.isAdmin ? ShieldMinus : ShieldPlus} size={14} spring="snappy" />
      {user.isAdmin ? "Remove platform admin" : "Make platform admin"}
    </MenuItem>
  );
}

/** Ban/unban and delete, hidden for your own row; ban is also hidden for
 * other platform admins. */
function DangerMenuItems({
  user,
  isSelf,
  onConfirm,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onConfirm: (kind: UserAction) => void;
}) {
  if (isSelf) return null;
  return (
    <>
      <MenuSeparator />
      {!user.isAdmin && (
        <MenuItem className="text-danger" onClick={() => onConfirm(user.banned ? "unban" : "ban")}>
          <Ban size={14} />
          {user.banned ? "Unban user" : "Ban user"}
        </MenuItem>
      )}
      <MenuItem className="text-danger" onClick={() => onConfirm("delete")}>
        <Trash2 size={14} /> Delete user
      </MenuItem>
    </>
  );
}

function UserRow({
  user,
  isSelf,
  onGrantComp,
  onRevokeComp,
  onConfirm,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onGrantComp: () => void;
  onRevokeComp: () => void;
  onConfirm: (kind: UserAction) => void;
}) {
  return (
    <tr>
      <Td>
        <span className="mr-1.5">{user.name}</span>
        {user.isAdmin && <Badge color="butter">admin</Badge>}{" "}
        {user.banned && <Badge color="pink">banned</Badge>}{" "}
        {!user.emailVerified && <Badge color="muted">unverified</Badge>}{" "}
        {user.disposable && <Badge color="accent">disposable</Badge>}
      </Td>
      <Td className="text-muted">{user.email}</Td>
      <Td className="tnum text-right">{user.orgCount}</Td>
      <Td>
        <Badge color={planBadgeColor[user.plan]}>{user.plan}</Badge>
      </Td>
      <Td>
        <BillingCell user={user} />
      </Td>
      <Td className="text-xs text-muted">{shortDate(user.createdAt)}</Td>
      <Td className="text-xs text-muted">{lastSeenLabel(user.lastSeen)}</Td>
      <Td>
        <Menu
          align="end"
          label={`Actions for ${user.name}`}
          trigger={
            <div className="flex justify-end">
              <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                <Ellipsis size={15} />
              </span>
            </div>
          }
        >
          <AdminToggleMenuItem user={user} isSelf={isSelf} onConfirm={onConfirm} />
          <CompMenuItems user={user} onGrant={onGrantComp} onRevoke={onRevokeComp} />
          <DangerMenuItems user={user} isSelf={isSelf} onConfirm={onConfirm} />
        </Menu>
      </Td>
    </tr>
  );
}

function UsersTable({
  rows,
  meId,
  sort,
  setSort,
  onGrantComp,
  onRevokeComp,
  onConfirm,
  searchTerm,
}: {
  rows: AdminUserRow[];
  meId: string | undefined;
  sort: Sort;
  setSort: (s: Sort) => void;
  onGrantComp: (user: AdminUserRow) => void;
  onRevokeComp: (user: AdminUserRow) => void;
  onConfirm: (kind: UserAction, user: AdminUserRow) => void;
  searchTerm: string;
}) {
  return (
    <Table minWidth="min-w-[64rem]">
      <thead>
        <tr>
          <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
          <Th>Email</Th>
          <SortTh label="Orgs" sortKey="orgs" sort={sort} onSort={setSort} className="text-right" />
          <Th>Plan</Th>
          <Th>Billing</Th>
          <SortTh label="Joined" sortKey="joined" sort={sort} onSort={setSort} />
          <SortTh label="Last seen" sortKey="lastSeen" sort={sort} onSort={setSort} />
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === meId}
            onGrantComp={() => onGrantComp(u)}
            onRevokeComp={() => onRevokeComp(u)}
            onConfirm={(kind) => onConfirm(kind, u)}
          />
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={8} className="py-8 text-center text-muted">
              No users match “{searchTerm}”.
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}

function UserActionConfirmDialog({
  confirm,
  onClose,
  onConfirm,
  pending,
}: {
  confirm: { kind: UserAction; user: AdminUserRow } | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  if (!confirm) return null;
  const meta = userActionMeta[confirm.kind];
  return (
    <ConfirmDialog
      title={meta.title}
      open
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel={meta.confirmLabel}
      danger={meta.danger}
      pending={pending}
    >
      {meta.body(confirm.user)}
    </ConfirmDialog>
  );
}

/**
 * Every privileged change an admin can make to a user, plus which user is
 * under the pointer for each. The page below is a table and two dialogs; this
 * is the part that writes.
 */
function useAdminUserActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: UserAction; user: AdminUserRow } | null>(null);
  const [compFor, setCompFor] = useState<AdminUserRow | null>(null);

  // All privileged changes go through one PATCH; the confirm popup closes on
  // success and each call site adds its own toast.
  const patchUser = useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string;
      body: { isAdmin?: boolean; banned?: boolean };
    }) => api(`/admin/users/${userId}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setConfirm(null);
    },
    onError: withErrorToast(toast),
  });

  // Comps have their own routes: they write the comp columns and re-derive
  // the plan, and they can never be mistaken for a Polar subscription (#81).
  //
  // `["user"]` goes too: an admin can comp their own account, and the cached
  // current user carries the plan that the rest of the app gates on.
  const compChanged = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["user"] });
  };

  const grantComp = useMutation({
    mutationFn: ({ userId, plan, reason }: { userId: string; plan: CompPlan; reason: string }) =>
      api(`/admin/users/${userId}/comp`, { method: "POST", body: { plan, reason } }),
    onSuccess: () => {
      compChanged();
      setCompFor(null);
      toast("Comp granted");
    },
    onError: withErrorToast(toast),
  });

  const revokeComp = useMutation({
    mutationFn: (userId: string) => api(`/admin/users/${userId}/comp`, { method: "DELETE" }),
    onSuccess: () => {
      compChanged();
      toast("Comp revoked");
    },
    onError: withErrorToast(toast),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      setConfirm(null);
      toast("User deleted");
    },
    onError: withErrorToast(toast),
  });

  const runAction = () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    const actions = {
      delete: () => remove.mutate(user.id),
      ban: () =>
        patchUser.mutate(
          { userId: user.id, body: { banned: true } },
          { onSuccess: () => toast("User banned") },
        ),
      unban: () =>
        patchUser.mutate(
          { userId: user.id, body: { banned: false } },
          { onSuccess: () => toast("User unbanned") },
        ),
      makeAdmin: () =>
        patchUser.mutate(
          { userId: user.id, body: { isAdmin: true } },
          { onSuccess: () => toast(`${user.name} is now a platform admin`) },
        ),
      removeAdmin: () =>
        patchUser.mutate(
          { userId: user.id, body: { isAdmin: false } },
          { onSuccess: () => toast("Platform admin removed") },
        ),
    } satisfies Record<UserAction, () => void>;
    actions[kind]();
  };

  return {
    confirm,
    setConfirm,
    compFor,
    setCompFor,
    runAction,
    grantComp,
    revokeComp,
    actionPending: patchUser.isPending || remove.isPending,
  };
}

export function AdminUsersPage() {
  const users = useAdminUsers();
  const currentUser = useCurrentUser();
  const {
    confirm,
    setConfirm,
    compFor,
    setCompFor,
    runAction,
    grantComp,
    revokeComp,
    actionPending,
  } = useAdminUserActions();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "joined", dir: -1 });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = (users.data ?? []).filter(
      (u) =>
        !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle),
    );
    return sortRows(matches, sort, {
      name: (u) => u.name.toLowerCase(),
      orgs: (u) => u.orgCount,
      joined: (u) => u.createdAt,
      lastSeen: (u) => u.lastSeen,
    });
  }, [users.data, q, sort]);

  const { totalPages, safePage, rows } = paginate(filtered, page);

  if (users.isLoading) return <AdminTableSkeleton />;
  return (
    <div>
      <PageHeader title="Users" sub="All accounts on this instance" />
      <SearchInput
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(0);
        }}
        placeholder="Search name or email…"
        label="Search users"
      />
      <UsersTable
        rows={rows}
        meId={currentUser.data?.user.id}
        sort={sort}
        setSort={setSort}
        onGrantComp={(u) => setCompFor(u)}
        onRevokeComp={(u) => revokeComp.mutate(u.id)}
        onConfirm={(kind, u) => setConfirm({ kind, user: u })}
        searchTerm={q.trim()}
      />
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <UserActionConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runAction}
        pending={actionPending}
      />

      {compFor && (
        <GrantCompDialog
          user={compFor}
          onClose={() => setCompFor(null)}
          onGrant={(plan, reason) => grantComp.mutate({ userId: compFor.id, plan, reason })}
          pending={grantComp.isPending}
        />
      )}
    </div>
  );
}
