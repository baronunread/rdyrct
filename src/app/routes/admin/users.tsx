import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Ellipsis, Trash2 } from "lucide-react";
import { ShieldMinus, ShieldPlus } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useAdminUsers, useCurrentUser } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminUserRow, OrgPlan, Sort } from "@/shared/types";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, PageHeader, Table, Td, Th } from "../../ui/misc";
import { AdminTableSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { SortTh } from "../../ui/sort-th";
import { withErrorToast } from "../../lib/mutation-toast";
import { sortRows } from "../../lib/sort";
import { shortDate } from "../../lib/dates";
import { lastSeenLabel } from "../../lib/last-seen";
import { Pager } from "../../ui/pagination";

const PAGE_SIZE = 25;

type UserAction = "delete" | "ban" | "unban" | "makeAdmin" | "removeAdmin";

const userActionMeta: Record<
  UserAction,
  {
    title: string;
    confirmLabel: string;
    danger: boolean;
    body: (u: AdminUserRow) => ReactNode;
  }
> = {
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
};

const planBadgeColor: Record<OrgPlan, "mint" | "accent" | "muted"> = {
  pro: "mint",
  hobby: "accent",
  free: "muted",
};

const PLAN_OPTIONS: OrgPlan[] = ["free", "hobby", "pro"];

/** The three "Set plan: …" menu items, with a checkmark on the current one. */
function PlanMenuItems({
  current,
  onSetPlan,
}: {
  current: OrgPlan;
  onSetPlan: (plan: OrgPlan) => void;
}) {
  return (
    <>
      {PLAN_OPTIONS.map((plan) => (
        <MenuItem key={plan} onClick={() => onSetPlan(plan)}>
          <span className="w-3.5">
            {current === plan && <Check size={13} className="text-accent" />}
          </span>
          Set plan: {plan}
        </MenuItem>
      ))}
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
  onSetPlan,
  onConfirm,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onSetPlan: (plan: OrgPlan) => void;
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
          <PlanMenuItems current={user.plan} onSetPlan={onSetPlan} />
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
  onSetPlan,
  onConfirm,
  searchTerm,
}: {
  rows: AdminUserRow[];
  meId: string | undefined;
  sort: Sort;
  setSort: (s: Sort) => void;
  onSetPlan: (user: AdminUserRow, plan: OrgPlan) => void;
  onConfirm: (kind: UserAction, user: AdminUserRow) => void;
  searchTerm: string;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
          <Th>Email</Th>
          <SortTh label="Orgs" sortKey="orgs" sort={sort} onSort={setSort} className="text-right" />
          <Th>Plan</Th>
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
            onSetPlan={(plan) => onSetPlan(u, plan)}
            onConfirm={(kind) => onConfirm(kind, u)}
          />
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={7} className="py-8 text-center text-muted">
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

export function AdminUsersPage() {
  const users = useAdminUsers();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{
    kind: UserAction;
    user: AdminUserRow;
  } | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "joined", dir: -1 });
  const [page, setPage] = useState(0);

  // All privileged changes go through one PATCH; the confirm popup closes on
  // success and each call site adds its own toast.
  const patchUser = useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string;
      body: { isAdmin?: boolean; banned?: boolean; plan?: OrgPlan };
    }) => api(`/admin/users/${userId}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setConfirm(null);
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
    const actions: Record<UserAction, () => void> = {
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
    };
    actions[kind]();
  };

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
        meId={me.data?.user.id}
        sort={sort}
        setSort={setSort}
        onSetPlan={(u, plan) =>
          patchUser.mutate(
            { userId: u.id, body: { plan } },
            { onSuccess: () => toast("Plan updated") },
          )
        }
        onConfirm={(kind, u) => setConfirm({ kind, user: u })}
        searchTerm={q.trim()}
      />
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <UserActionConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runAction}
        pending={patchUser.isPending || remove.isPending}
      />
    </div>
  );
}
