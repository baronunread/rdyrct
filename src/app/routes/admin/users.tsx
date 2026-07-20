import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  Ellipsis,
  ShieldMinus,
  ShieldPlus,
  Trash2,
} from "lucide-react";
import { useAdminUsers, useCurrentUser } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminUserRow, OrgPlan } from "@/shared/types";
import { Menu, MenuItem, MenuSeparator } from "../../ui/menu";
import { Badge, PageHeader, Table, Td, Th } from "../../ui/misc";
import { AdminTableSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { ConfirmDialog } from "./confirm-dialog";
import { SearchInput } from "./search-input";
import { SortTh } from "./sort";
import { sortRows, type Sort } from "./util";

/** "today" / "3d ago" / a date, for the users table's last-seen column. */
const lastSeenLabel = (ts: number | null) => {
  if (!ts) return "never";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

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
        Delete <span className="font-bold text-accent">{u.name}</span>? Their
        sessions, linked accounts, and org memberships are removed. Links and
        invites they created stay, unattributed. If they own any organization,
        delete that organization first. This cannot be undone.
      </>
    ),
  },
  ban: {
    title: "Ban user",
    confirmLabel: "Ban user",
    danger: true,
    body: (u) => (
      <>
        Ban <span className="font-bold text-accent">{u.name}</span>? They are
        signed out immediately and cannot sign back in. Their organizations,
        links, and QR codes keep working. You can unban them anytime.
      </>
    ),
  },
  unban: {
    title: "Unban user",
    confirmLabel: "Unban user",
    danger: false,
    body: (u) => (
      <>
        Unban <span className="font-bold text-accent">{u.name}</span>? They can
        sign in again right away.
      </>
    ),
  },
  makeAdmin: {
    title: "Make platform admin",
    confirmLabel: "Make platform admin",
    danger: false,
    body: (u) => (
      <>
        Make <span className="font-bold text-accent">{u.name}</span> a platform
        admin? They get full access to this admin area: every user,
        organization, and link on the instance.
      </>
    ),
  },
  removeAdmin: {
    title: "Remove platform admin",
    confirmLabel: "Remove platform admin",
    danger: true,
    body: (u) => (
      <>
        Remove <span className="font-bold text-accent">{u.name}</span>'s
        platform admin? They keep their organizations and links but lose
        access to this admin area.
      </>
    ),
  },
};

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
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      setConfirm(null);
      toast("User deleted");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const runAction = () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    switch (kind) {
      case "delete":
        remove.mutate(user.id);
        break;
      case "ban":
        patchUser.mutate(
          { userId: user.id, body: { banned: true } },
          { onSuccess: () => toast("User banned") },
        );
        break;
      case "unban":
        patchUser.mutate(
          { userId: user.id, body: { banned: false } },
          { onSuccess: () => toast("User unbanned") },
        );
        break;
      case "makeAdmin":
        patchUser.mutate(
          { userId: user.id, body: { isAdmin: true } },
          { onSuccess: () => toast(`${user.name} is now a platform admin`) },
        );
        break;
      case "removeAdmin":
        patchUser.mutate(
          { userId: user.id, body: { isAdmin: false } },
          { onSuccess: () => toast("Platform admin removed") },
        );
        break;
    }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (users.data ?? []).filter(
      (u) =>
        !needle ||
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle),
    );
    return sortRows(filtered, sort, {
      name: (u) => u.name.toLowerCase(),
      orgs: (u) => u.orgCount,
      joined: (u) => u.createdAt,
      lastSeen: (u) => u.lastSeen,
    });
  }, [users.data, q, sort]);

  if (users.isLoading) return <AdminTableSkeleton />;
  const meta = confirm ? userActionMeta[confirm.kind] : null;
  return (
    <div>
      <PageHeader title="Users" sub="All accounts on this instance" />
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Search name or email…"
        label="Search users"
      />
      <Table>
        <thead>
          <tr>
            <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
            <Th>Email</Th>
            <SortTh
              label="Orgs"
              sortKey="orgs"
              sort={sort}
              onSort={setSort}
              className="text-right"
            />
            <Th>Plan</Th>
            <SortTh
              label="Joined"
              sortKey="joined"
              sort={sort}
              onSort={setSort}
            />
            <SortTh
              label="Last seen"
              sortKey="lastSeen"
              sort={sort}
              onSort={setSort}
            />
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const isSelf = u.id === me.data?.user.id;
            return (
              <tr key={u.id}>
                <Td>
                  <span className="mr-1.5">{u.name}</span>
                  {u.isAdmin && <Badge color="butter">admin</Badge>}{" "}
                  {u.banned && <Badge color="pink">banned</Badge>}{" "}
                  {!u.emailVerified && <Badge color="muted">unverified</Badge>}
                </Td>
                <Td className="text-muted">{u.email}</Td>
                <Td className="tnum text-right">{u.orgCount}</Td>
                <Td>
                  <Badge color={u.plan === "pro" ? "mint" : "muted"}>
                    {u.plan}
                  </Badge>
                </Td>
                <Td className="text-xs text-muted">
                  {new Date(u.createdAt).toLocaleDateString()}
                </Td>
                <Td className="text-xs text-muted">
                  {lastSeenLabel(u.lastSeen)}
                </Td>
                <Td>
                  <Menu
                    align="end"
                    label={`Actions for ${u.name}`}
                    trigger={
                      <div className="flex justify-end">
                        <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                          <Ellipsis size={15} />
                        </span>
                      </div>
                    }
                  >
                    {!isSelf && (
                      <MenuItem
                        onClick={() =>
                          setConfirm({
                            kind: u.isAdmin ? "removeAdmin" : "makeAdmin",
                            user: u,
                          })
                        }
                      >
                        {u.isAdmin ? (
                          <ShieldMinus size={14} />
                        ) : (
                          <ShieldPlus size={14} />
                        )}
                        {u.isAdmin
                          ? "Remove platform admin"
                          : "Make platform admin"}
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() =>
                        patchUser.mutate(
                          { userId: u.id, body: { plan: "free" } },
                          { onSuccess: () => toast("Plan updated") },
                        )
                      }
                    >
                      <span className="w-3.5">
                        {u.plan === "free" && (
                          <Check size={13} className="text-accent" />
                        )}
                      </span>
                      Set plan: free
                    </MenuItem>
                    <MenuItem
                      onClick={() =>
                        patchUser.mutate(
                          { userId: u.id, body: { plan: "pro" } },
                          { onSuccess: () => toast("Plan updated") },
                        )
                      }
                    >
                      <span className="w-3.5">
                        {u.plan === "pro" && (
                          <Check size={13} className="text-accent" />
                        )}
                      </span>
                      Set plan: pro
                    </MenuItem>
                    {!isSelf && <MenuSeparator />}
                    {!isSelf && !u.isAdmin && (
                      <MenuItem
                        className="text-danger"
                        onClick={() =>
                          setConfirm({
                            kind: u.banned ? "unban" : "ban",
                            user: u,
                          })
                        }
                      >
                        <Ban size={14} />
                        {u.banned ? "Unban user" : "Ban user"}
                      </MenuItem>
                    )}
                    {!isSelf && (
                      <MenuItem
                        className="text-danger"
                        onClick={() => setConfirm({ kind: "delete", user: u })}
                      >
                        <Trash2 size={14} /> Delete user
                      </MenuItem>
                    )}
                  </Menu>
                </Td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-8 text-center text-muted">
                No users match “{q.trim()}”.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      {meta && confirm && (
        <ConfirmDialog
          title={meta.title}
          open
          onClose={() => setConfirm(null)}
          onConfirm={runAction}
          confirmLabel={meta.confirmLabel}
          danger={meta.danger}
          pending={patchUser.isPending || remove.isPending}
        >
          {meta.body(confirm.user)}
        </ConfirmDialog>
      )}
    </div>
  );
}
