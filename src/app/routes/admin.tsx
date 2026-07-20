import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Check,
  Ellipsis,
  Eye,
  Search,
  ShieldMinus,
  ShieldPlus,
  Trash2,
} from "lucide-react";
import {
  useAdminOverview,
  useAdminOrgs,
  useAdminOrgDetail,
  useAdminUsers,
  useMe,
} from "../lib/hooks";
import { api } from "../lib/api";
import type {
  AdminOrgRow,
  AdminUserRow,
  OrgPlan,
  OrgRole,
} from "@/shared/types";
import { AreaChart, BarList, StatCard } from "../components/charts";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/field";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { cn } from "../ui/cn";
import {
  Card,
  Table,
  Th,
  Td,
  Badge,
  PageHeader,
} from "../ui/misc";
import {
  AdminOverviewSkeleton,
  AdminTableSkeleton,
  OrgDetailSkeleton,
} from "../components/skeletons";
import { useToast } from "../ui/toast";

const roleColor: Record<OrgRole, "accent" | "mint" | "muted"> = {
  owner: "accent",
  admin: "mint",
  member: "muted",
};

const linkLabel = (l: { domain: string | null; slug: string }) =>
  l.domain ? `${l.domain}/${l.slug}` : `/${l.slug}`;

/** "today" / "3d ago" / a date, for the users table's last-seen column. */
const lastSeenLabel = (ts: number | null) => {
  if (!ts) return "never";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

/* ---------- shared bits ---------- */

/** Single confirmation popup for every destructive/privileged row action. */
function ConfirmDialog({
  title,
  open,
  onClose,
  onConfirm,
  confirmLabel,
  danger,
  pending,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{children}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative mb-4 max-w-xs">
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <Input
        className="pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}

type Sort = { key: string; dir: 1 | -1 };

/** Click-to-sort table header; toggles direction when already active. */
function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (s: Sort) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <Th className={className}>
      <button
        type="button"
        onClick={() =>
          onSort({ key: sortKey, dir: active && sort.dir === 1 ? -1 : 1 })
        }
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 tracking-wider uppercase",
          active ? "text-text" : "hover:text-text",
        )}
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp size={11} />
          ) : (
            <ArrowDown size={11} />
          )
        ) : (
          <ArrowUpDown size={11} className="opacity-40" />
        )}
      </button>
    </Th>
  );
}

function sortRows<T>(
  rows: T[],
  sort: Sort,
  getters: Record<string, (r: T) => string | number | null>,
): T[] {
  const get = getters[sort.key];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always sink to the bottom
    if (vb == null) return -1;
    const cmp =
      typeof va === "string"
        ? va.localeCompare(vb as string)
        : va - (vb as number);
    return cmp * sort.dir;
  });
}

/* ---------- overview ---------- */

export function AdminOverviewPage() {
  const overview = useAdminOverview();
  if (overview.isLoading) return <AdminOverviewSkeleton />;
  if (!overview.data)
    return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = overview.data;
  return (
    <div>
      <PageHeader
        title="Platform usage"
        sub="Everything, across all organizations"
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Users" value={s.users} />
        <StatCard label="Pro users" value={s.proUsers} />
        <StatCard label="Orgs" value={s.orgs} />
        <StatCard label="Links" value={s.links} />
        <StatCard label="Clicks" value={s.clicks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Clicks per day · 30d
          </p>
          <AreaChart data={s.series} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Signups per day · 30d
          </p>
          <AreaChart data={s.signups} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top organizations · 30d
          </p>
          <BarList
            items={s.topOrgs.map((o) => ({ key: o.id, clicks: o.clicks }))}
            formatKey={(id) =>
              s.topOrgs.find((o) => o.id === id)?.name ?? id
            }
          />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top links · 30d
          </p>
          <BarList
            items={s.topLinks.map((l) => ({ key: l.id, clicks: l.clicks }))}
            formatKey={(id) => {
              const l = s.topLinks.find((t) => t.id === id);
              return l ? `${linkLabel(l)} · ${l.orgName}` : id;
            }}
          />
        </Card>
      </div>
    </div>
  );
}

/* ---------- organizations ---------- */

function OrgDetailDialog({
  org,
  onClose,
}: {
  org: AdminOrgRow | null;
  onClose: () => void;
}) {
  const detail = useAdminOrgDetail(org?.id ?? null);
  return (
    <Dialog
      open={!!org}
      onOpenChange={(o) => !o && onClose()}
      title={org?.name ?? ""}
      wide
    >
      {org && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge color={org.plan === "pro" ? "mint" : "muted"}>
              {org.plan}
            </Badge>
            <span className="text-xs text-muted">
              Created {new Date(org.createdAt).toLocaleDateString()}
            </span>
          </div>

          {detail.isLoading || !detail.data ? (
            <OrgDetailSkeleton />
          ) : (
            <>
              <Card>
                <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
                  Clicks per day · 30d
                </p>
                <AreaChart data={detail.data.series} />
              </Card>

              <div>
                <p className="mb-2 text-[11px] tracking-wider text-muted uppercase">
                  Members
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Role</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.members.map((m) => (
                      <tr key={m.userId}>
                        <Td>{m.name}</Td>
                        <Td className="text-muted">{m.email}</Td>
                        <Td>
                          <Badge color={roleColor[m.role]}>{m.role}</Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div>
                <p className="mb-2 text-[11px] tracking-wider text-muted uppercase">
                  Links
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>Short link</Th>
                      <Th>Destination</Th>
                      <Th className="text-right">Clicks</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.links.map((l) => (
                      <tr key={l.id}>
                        <Td className="font-bold text-accent">
                          {linkLabel(l)}
                        </Td>
                        <Td className="max-w-64 truncate text-muted">
                          {l.destination}
                        </Td>
                        <Td className="tnum text-right">{l.clicks}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AdminOrgsPage() {
  const orgs = useAdminOrgs();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<AdminOrgRow | null>(null);
  const [viewing, setViewing] = useState<AdminOrgRow | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "created", dir: -1 });

  const remove = useMutation({
    mutationFn: (orgId: string) =>
      api(`/admin/orgs/${orgId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["user"] });
      setDeleting(null);
      toast("Organization deleted");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (orgs.data ?? []).filter(
      (o) => !needle || o.name.toLowerCase().includes(needle),
    );
    return sortRows(filtered, sort, {
      name: (o) => o.name.toLowerCase(),
      members: (o) => o.members,
      links: (o) => o.links,
      clicks: (o) => o.clicks,
      created: (o) => o.createdAt,
    });
  }, [orgs.data, q, sort]);

  if (orgs.isLoading) return <AdminTableSkeleton />;
  return (
    <div>
      <PageHeader
        title="Organizations"
        sub="All organizations on this instance"
      />
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="Search organizations…"
        label="Search organizations"
      />
      <Table>
        <thead>
          <tr>
            <SortTh label="Name" sortKey="name" sort={sort} onSort={setSort} />
            <Th>Plan</Th>
            <SortTh
              label="Members"
              sortKey="members"
              sort={sort}
              onSort={setSort}
              className="text-right"
            />
            <SortTh
              label="Links"
              sortKey="links"
              sort={sort}
              onSort={setSort}
              className="text-right"
            />
            <SortTh
              label="Clicks"
              sortKey="clicks"
              sort={sort}
              onSort={setSort}
              className="text-right"
            />
            <SortTh
              label="Created"
              sortKey="created"
              sort={sort}
              onSort={setSort}
            />
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((org) => (
            <tr key={org.id}>
              <Td className="font-bold">
                <button
                  type="button"
                  onClick={() => setViewing(org)}
                  className="cursor-pointer text-accent hover:underline"
                >
                  {org.name}
                </button>
              </Td>
              <Td>
                <Badge color={org.plan === "pro" ? "mint" : "muted"}>
                  {org.plan}
                </Badge>
              </Td>
              <Td className="tnum text-right">{org.members}</Td>
              <Td className="tnum text-right">{org.links}</Td>
              <Td className="tnum text-right">{org.clicks}</Td>
              <Td className="text-xs text-muted">
                {new Date(org.createdAt).toLocaleDateString()}
              </Td>
              <Td>
                <Menu
                  align="end"
                  label={`Actions for ${org.name}`}
                  trigger={
                    <div className="flex justify-end">
                      <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                        <Ellipsis size={15} />
                      </span>
                    </div>
                  }
                >
                  <MenuItem onClick={() => setViewing(org)}>
                    <Eye size={14} /> View details
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    className="text-danger"
                    onClick={() => setDeleting(org)}
                  >
                    <Trash2 size={14} /> Delete organization
                  </MenuItem>
                </Menu>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-8 text-center text-muted">
                No organizations match “{q.trim()}”.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      <OrgDetailDialog org={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        title="Delete organization"
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        confirmLabel="Delete organization"
        danger
        pending={remove.isPending}
      >
        {deleting && (
          <>
            Delete{" "}
            <span className="font-bold text-accent">{deleting.name}</span> with{" "}
            {deleting.links} links and {deleting.clicks} recorded clicks? All
            its short links stop working. This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

/* ---------- users ---------- */

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
  const me = useMe();
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
