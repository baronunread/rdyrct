import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Trash2 } from "@/app/ui/icons";
import { MorphIcon } from "morphicons/react";
import { shieldMinus, shieldPlus } from "@/app/ui/icon-nodes";
import { useCurrentUser } from "../../lib/hooks";
import { useAdminUsersData, type AdminUserData } from "../../lib/admin-data";
import { UserAvatar } from "../../components/user-avatar";
import { api } from "../../lib/api";
import type { AdminUserRow, Sort } from "@/shared/types";
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
import { BanDialog } from "./ban-dialog";

type UserAction = "delete" | "ban" | "unban" | "makeAdmin" | "removeAdmin";
/** Every action but the ban, which has its own dialog (ban-dialog.tsx). */
type ConfirmedAction = Exclude<UserAction, "ban">;

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

/**
 * What the plan column adds to the plan, when there is something to add: a
 * comp (not somebody paying, #81 and #82), a payment that is failing, or a
 * subscription that ends. Each is a state worth finding at a glance, so each
 * is a badge. The plan itself is an attribute of the row, so it is text.
 */
function PlanNote({ user }: { user: AdminUserRow }) {
  if (user.compPlan) {
    // The reason an admin typed hangs off the badge on hover instead of
    // setting the row's height.
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
      <MorphIcon icon={user.isAdmin ? shieldMinus : shieldPlus} size={14} spring="snappy" />
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

/** Marks on the person that change what an admin does next. Each is a
 * state, so each keeps its pill; "banned" is said in the Last active column,
 * where it replaces the date. */
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
  showLinks,
  onGrantComp,
  onRevokeComp,
  onConfirm,
}: {
  user: AdminUserData;
  showLinks: boolean;
  isSelf: boolean;
  onGrantComp: () => void;
  onRevokeComp: () => void;
  onConfirm: (kind: UserAction) => void;
}) {
  return (
    <tr className={PHONE.row}>
      {/* Two lines (rdyrct-design, "Tables earn two lines"): the name over
          the address, beside the picture. Both truncate, with the whole
          value on hover. */}
      <Td className={PHONE.main}>
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar
            user={{ id: user.id, image: user.image ?? null, name: user.name, email: user.email }}
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
      {/* The plan is an attribute, so it is text; what it adds (a comp, a
          failing payment, an end date) is a state, so it is a pill. */}
      <Td className={PHONE.meta} data-label="Plan">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={user.plan === "free" ? "text-muted capitalize" : "capitalize"}>
            {user.plan}
          </span>
          <PlanNote user={user} />
        </span>
      </Td>
      <Td className={`tnum text-right ${PHONE.meta}`} data-label="Orgs">
        {fullNumber(user.orgCount)}
      </Td>
      {showLinks && (
        <Td className={`tnum text-right ${PHONE.meta}`} data-label="Links">
          {user.links === undefined ? "" : fullNumber(user.links)}
        </Td>
      )}
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
  emptyText,
}: {
  rows: AdminUserData[];
  meId: string | undefined;
  sort: Sort;
  setSort: (s: Sort) => void;
  onGrantComp: (user: AdminUserRow) => void;
  onRevokeComp: (user: AdminUserRow) => void;
  onConfirm: (kind: UserAction, user: AdminUserRow) => void;
  emptyText: string;
}) {
  // The column waits for the API to count each person's links; a column of
  // blanks would say "none" when it means "not known".
  const showLinks = rows.some((u) => u.links !== undefined);
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
          {showLinks && (
            <SortTh
              label="Links"
              sortKey="links"
              sort={sort}
              onSort={setSort}
              className="w-20 text-right"
            />
          )}
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
            showLinks={showLinks}
            isSelf={u.id === meId}
            onGrantComp={() => onGrantComp(u)}
            onRevokeComp={() => onRevokeComp(u)}
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

/** The filters above the table. "Paid" is somebody paying: a comp grants
 * the same access and is counted on its own (#82). */
const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "paid", label: "Paid", test: (u) => u.plan !== "free" && !u.compPlan },
  { id: "comped", label: "Comped", test: (u) => !!u.compPlan },
  { id: "banned", label: "Banned", test: (u) => u.banned },
  { id: "admins", label: "Admins", test: (u) => u.isAdmin },
] as const satisfies readonly { id: string; label: string; test: (u: AdminUserRow) => boolean }[];
type UserFilter = (typeof FILTERS)[number]["id"];

const filterTest = (id: UserFilter) => FILTERS.find((f) => f.id === id)?.test ?? (() => true);

/** What an empty table says: the search it found nothing for, or the filter. */
function emptyMessage(filter: UserFilter, term: string): string {
  if (term) return `No users match “${term}”.`;
  const label = FILTERS.find((f) => f.id === filter)?.label.toLowerCase();
  return filter === "all" ? "No users yet." : `No ${label} users.`;
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
    runAction,
    grantComp,
    revokeComp,
    actionPending: patchUser.isPending || remove.isPending,
  };
}

export function AdminUsersPage() {
  const users = useAdminUsersData();
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
      links: (u) => u.links ?? 0,
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
      {/* Rows only: the header and search box above are real, so the
          page-level skeleton would draw a second one of each. */}
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
          onConfirm={(kind, u) => setConfirm({ kind, user: u })}
          emptyText={emptyMessage(filter, q.trim())}
        />
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />

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
    </div>
  );
}
