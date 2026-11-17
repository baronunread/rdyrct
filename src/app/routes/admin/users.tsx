import { useMemo, useState, type ReactNode } from "react";
import { settle } from "../../lib/route-preload";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Ban, Check, Trash2 } from "@/app/ui/icons";
import { MorphIcon } from "morphicons/react";
import { shieldMinus, shieldPlus } from "@/app/ui/icon-nodes";
import { useCurrentUser } from "../../lib/hooks";
import { adminUsersQuery, useAdminUsersData } from "../../lib/admin-data";
import { UserAvatar } from "../../components/user-avatar";
import { api } from "../../lib/api";
import type { AdminUserRow, LimitOverrides, Sort } from "@/shared/types";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, Table, Td, Th } from "../../ui/misc";
import {
  FilterBar,
  FilterRow,
  PHONE,
  RowMenuTrigger,
  SectionHeading,
  StateLabel,
  TwoLine,
  fullNumber,
} from "./admin-kit";
import { Tooltip } from "../../ui/tooltip";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { SearchInput } from "./search-input";
import { TableSkeleton } from "../../ui/skeleton";
import { paginate } from "./util";
import { SortTh } from "../../ui/sort-th";
import { withErrorToast } from "../../lib/mutation-toast";
import { sortRows } from "../../lib/sort";
import { shortDate } from "../../lib/dates";
import { lastSeenLabel } from "../../lib/last-seen";
import { Pager } from "../../ui/pagination";
import { GrantCompDialog, type CompPlan } from "./comp-dialog";
import { LimitsDialog } from "./limits-dialog";
import { BanDialog } from "./ban-dialog";

type UserAction = "delete" | "ban" | "unban" | "makeAdmin" | "removeAdmin";
type ConfirmedAction = Exclude<UserAction, "ban">;

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
        Delete <span className="font-semibold text-text">{u.name}</span>? Their account, sessions
        and memberships are removed, and so is every organization they own, with its links, members
        and click history. Those short links stop working. Links they made in organizations owned by
        others stay, unattributed. This cannot be undone.
      </>
    ),
  },
  unban: {
    title: "Unban user",
    confirmLabel: "Unban user",
    danger: false,
    body: (u) => (
      <>
        Unban <span className="font-semibold text-text">{u.name}</span>? They can sign in again
        right away, and the organizations they own that are not deleted yet work again. Hosts
        blocked with the ban stay blocked.
      </>
    ),
  },
  makeAdmin: {
    title: "Make platform admin",
    confirmLabel: "Make platform admin",
    danger: false,
    body: (u) => (
      <>
        Make <span className="font-semibold text-text">{u.name}</span> a platform admin? They get
        full access to this admin area: every user, organization, and link on the instance.
      </>
    ),
  },
  removeAdmin: {
    title: "Remove platform admin",
    confirmLabel: "Remove platform admin",
    danger: true,
    body: (u) => (
      <>
        Remove <span className="font-semibold text-text">{u.name}</span>'s platform admin? They keep
        their organizations and links but lose access to this admin area.
      </>
    ),
  },
} satisfies Record<ConfirmedAction, UserActionMeta>;

function PlanNote({ user }: { user: AdminUserRow }) {
  if (user.compPlan) {
    const detail = [user.compReason ?? "No reason recorded.", user.compGrantedBy]
      .filter(Boolean)
      .join(" · ");
    return (
      <Tooltip content={detail}>
        <span className="inline-flex">
          <Badge color="butter">comped</Badge>
        </span>
      </Tooltip>
    );
  }
  if (user.subscriptionStatus === "past_due")
    return (
      <Badge color="pink" className="whitespace-nowrap">
        past due
      </Badge>
    );
  if (user.cancelAtPeriodEnd && user.plan !== "free")
    return (
      <Badge color="butter" className="whitespace-nowrap">
        {user.currentPeriodEnd ? `cancels ${shortDate(user.currentPeriodEnd)}` : "cancels"}
      </Badge>
    );
  return null;
}

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

function LimitsKeptBadge({ user }: { user: AdminUserRow }) {
  if (!user.limitOverrides || user.tier === "enterprise") return null;
  return <Badge color="muted">limits kept</Badge>;
}

function LimitsMenuItem({ user, onClick }: { user: AdminUserRow; onClick: () => void }) {
  return (
    <MenuItem onClick={onClick}>
      <span className="w-3.5">
        {user.limitOverrides && <Check size={13} className="text-accent" />}
      </span>
      {user.limitOverrides ? "Custom limits" : "Set custom limits…"}
    </MenuItem>
  );
}

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
      <MorphIcon icon={user.isAdmin ? shieldMinus : shieldPlus} size={14} spring="snappy" />
      {user.isAdmin ? "Remove platform admin" : "Make platform admin"}
    </MenuItem>
  );
}

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

function PersonMarks({ user }: { user: AdminUserRow }) {
  return (
    <>
      {user.isAdmin && <Badge color="butter">admin</Badge>}
      {!user.emailVerified && <Badge color="muted">unverified</Badge>}
      {user.disposable && <Badge color="accent">disposable</Badge>}
    </>
  );
}

function UserRow({
  user,
  isSelf,
  onGrantComp,
  onRevokeComp,
  onSetLimits,
  onConfirm,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onGrantComp: () => void;
  onRevokeComp: () => void;
  onSetLimits: () => void;
  onConfirm: (kind: UserAction) => void;
}) {
  return (
    <tr className={PHONE.row}>
      <Td className={PHONE.main}>
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar
            user={{ id: user.id, image: user.image, name: user.name, email: user.email }}
            size={32}
          />
          <span className="min-w-0">
            <TwoLine
              title={user.name}
              titleHint={user.name}
              sub={user.email}
              subHint={user.email}
            />
          </span>
          <span className="flex shrink-0 gap-1">
            <PersonMarks user={user} />
          </span>
        </span>
      </Td>
      <Td className={PHONE.meta} data-label="Plan">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={user.tier === "free" ? "text-muted capitalize" : "capitalize"}>
            {user.tier}
          </span>
          <PlanNote user={user} />
          <LimitsKeptBadge user={user} />
        </span>
      </Td>
      <Td className={`tnum text-right ${PHONE.meta}`} data-label="Orgs">
        {fullNumber(user.orgCount)}
      </Td>
      <Td className={`tnum text-right ${PHONE.meta}`} data-label="Links">
        {fullNumber(user.links)}
      </Td>
      <Td className={`whitespace-nowrap ${PHONE.meta}`} data-label="Seen">
        {user.banned ? (
          <StateLabel tone="bad">banned</StateLabel>
        ) : (
          <span className="inline-block text-sm text-muted first-letter:uppercase">
            {lastSeenLabel(user.lastSeen)}
          </span>
        )}
      </Td>
      <Td className={`tnum text-sm whitespace-nowrap text-muted ${PHONE.meta}`} data-label="Joined">
        {shortDate(user.createdAt)}
      </Td>
      <Td className={`px-2 ${PHONE.menu}`}>
        <Menu align="end" label={`Actions for ${user.name}`} trigger={<RowMenuTrigger />}>
          <AdminToggleMenuItem user={user} isSelf={isSelf} onConfirm={onConfirm} />
          <CompMenuItems user={user} onGrant={onGrantComp} onRevoke={onRevokeComp} />
          <LimitsMenuItem user={user} onClick={onSetLimits} />
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
  onSetLimits,
  onConfirm,
  emptyText,
}: {
  rows: AdminUserRow[];
  meId: string | undefined;
  sort: Sort;
  setSort: (s: Sort) => void;
  onGrantComp: (user: AdminUserRow) => void;
  onRevokeComp: (user: AdminUserRow) => void;
  onSetLimits: (user: AdminUserRow) => void;
  onConfirm: (kind: UserAction, user: AdminUserRow) => void;
  emptyText: string;
}) {
  return (
    <Table fixed minWidth={`sm:min-w-[52rem] ${PHONE.table}`}>
      <thead className={PHONE.head}>
        <tr>
          <SortTh label="Person" sortKey="name" sort={sort} onSort={setSort} />
          <Th className="w-[18%]">Plan</Th>
          <SortTh
            label="Orgs"
            sortKey="orgs"
            sort={sort}
            onSort={setSort}
            className="w-20 text-right"
          />
          <SortTh
            label="Links"
            sortKey="links"
            sort={sort}
            onSort={setSort}
            className="w-20 text-right"
          />
          <SortTh
            label="Last active"
            sortKey="lastSeen"
            sort={sort}
            onSort={setSort}
            className="w-32"
          />
          <SortTh label="Joined" sortKey="joined" sort={sort} onSort={setSort} className="w-32" />
          <Th className="w-12 px-2">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody className={PHONE.body}>
        {rows.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === meId}
            onGrantComp={() => onGrantComp(u)}
            onRevokeComp={() => onRevokeComp(u)}
            onSetLimits={() => onSetLimits(u)}
            onConfirm={(kind) => onConfirm(kind, u)}
          />
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={7} className="block py-8 text-center text-muted sm:table-cell">
              {emptyText}
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
  if (!confirm || confirm.kind === "ban") return null;
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

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "paid", label: "Paid", test: (u) => u.plan !== "free" && !u.compPlan },
  { id: "comped", label: "Comped", test: (u) => !!u.compPlan },
  { id: "banned", label: "Banned", test: (u) => u.banned },
  { id: "admins", label: "Admins", test: (u) => u.isAdmin },
  { id: "news", label: "Product news", test: (u) => u.news === "on" },
  { id: "offers", label: "Offers", test: (u) => u.offers === "on" },
] as const satisfies readonly { id: string; label: string; test: (u: AdminUserRow) => boolean }[];
type UserFilter = (typeof FILTERS)[number]["id"];

const filterTest = (id: UserFilter) => FILTERS.find((f) => f.id === id)?.test ?? (() => true);

function emptyMessage(filter: UserFilter, term: string): string {
  if (term) return `No users match “${term}”.`;
  if (filter === "news") return "Nobody has opted in to product news yet.";
  if (filter === "offers") return "Nobody has opted in to offers yet.";
  const label = FILTERS.find((f) => f.id === filter)?.label.toLowerCase();
  return filter === "all" ? "No users yet." : `No ${label} users.`;
}

function useAdminUserActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: UserAction; user: AdminUserRow } | null>(null);
  const [compFor, setCompFor] = useState<AdminUserRow | null>(null);
  const [limitsFor, setLimitsFor] = useState<AdminUserRow | null>(null);

  const patchUser = useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string;
      body: { isAdmin?: boolean; banned?: boolean };
    }) => api(`/admin/users/${userId}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setConfirm(null);
    },
    onError: withErrorToast(toast),
  });

  // Comp routes write the comp columns and re-derive the plan (#81). `["user"]` too: an admin can comp their own account.
  const compChanged = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    void qc.invalidateQueries({ queryKey: ["user"] });
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

  const setLimits = useMutation({
    mutationFn: ({
      userId,
      overrides,
      note,
    }: {
      userId: string;
      overrides: LimitOverrides | null;
      note: string;
    }) => api(`/admin/users/${userId}/limits`, { method: "PUT", body: { overrides, note } }),
    onSuccess: (_data, { overrides }) => {
      compChanged();
      setLimitsFor(null);
      toast(overrides === null ? "Custom limits cleared" : "Custom limits set");
    },
    onError: withErrorToast(toast),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
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
    } satisfies Record<ConfirmedAction, () => void>;
    if (kind !== "ban") actions[kind]();
  };

  return {
    confirm,
    setConfirm,
    compFor,
    setCompFor,
    limitsFor,
    setLimitsFor,
    setLimits,
    runAction,
    grantComp,
    revokeComp,
    actionPending: patchUser.isPending || remove.isPending,
  };
}

function UserDialogs({ actions }: { actions: ReturnType<typeof useAdminUserActions> }) {
  const {
    confirm,
    setConfirm,
    compFor,
    setCompFor,
    limitsFor,
    setLimitsFor,
    setLimits,
    runAction,
    grantComp,
    actionPending,
  } = actions;
  return (
    <>
      <BanDialog
        user={confirm?.kind === "ban" ? confirm.user : null}
        onClose={() => setConfirm(null)}
      />
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
      {limitsFor && (
        <LimitsDialog
          user={limitsFor}
          onClose={() => setLimitsFor(null)}
          onSave={(overrides, note) => setLimits.mutate({ userId: limitsFor.id, overrides, note })}
          pending={setLimits.isPending}
        />
      )}
    </>
  );
}

export const preload = (qc: QueryClient) => settle([qc.ensureQueryData(adminUsersQuery)]);

export function AdminUsersPage() {
  const users = useAdminUsersData();
  const currentUser = useCurrentUser();
  const actions = useAdminUserActions();
  const { setConfirm, setCompFor, setLimitsFor, revokeComp } = actions;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [sort, setSort] = useState<Sort>({ key: "joined", dir: -1 });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pass = filterTest(filter);
    const matches = (users.data ?? []).filter(
      (u) =>
        pass(u) &&
        (!needle ||
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle)),
    );
    return sortRows(matches, sort, {
      name: (u) => u.name.toLowerCase(),
      orgs: (u) => u.orgCount,
      links: (u) => u.links,
      joined: (u) => u.createdAt,
      lastSeen: (u) => u.lastSeen,
    });
  }, [users.data, q, filter, sort]);
  const counts = useMemo(
    () =>
      FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        count: (users.data ?? []).filter((u) => f.test(u)).length,
      })),
    [users.data],
  );

  const { totalPages, safePage, rows } = paginate(filtered, page);

  return (
    <div>
      <SectionHeading>Users</SectionHeading>
      <div className="mb-4">
        <FilterBar>
          <FilterRow
            label="Filter users"
            items={counts}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPage(0);
            }}
          />
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(0);
            }}
            placeholder="Search email or name"
            label="Search users"
          />
        </FilterBar>
      </div>
      {users.isLoading ? (
        <TableSkeleton rows={6} testId="admin-users-rows-skeleton" />
      ) : (
        <UsersTable
          rows={rows}
          meId={currentUser.data?.user.id}
          sort={sort}
          setSort={setSort}
          onGrantComp={(u) => setCompFor(u)}
          onRevokeComp={(u) => revokeComp.mutate(u.id)}
          onSetLimits={(u) => setLimitsFor(u)}
          onConfirm={(kind, u) => setConfirm({ kind, user: u })}
          emptyText={emptyMessage(filter, q.trim())}
        />
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

      <UserDialogs actions={actions} />
    </div>
  );
}
