/**
 * Cross-org link moderation (#67).
 *
 * The screen somebody opens with an abuse report in front of them. It is
 * built around that: one search box that takes either a slug or a destination,
 * because those are the two things a report contains, and one action that
 * stops a link without touching anything else the organization owns.
 *
 * Anonymous links (#96) are listed here too rather than in a tab of their
 * own. A report naming a slug does not know which table it came from, and
 * two places to search is one place too many at 2am.
 */
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, Trash2, Undo2, X } from "lucide-react";
import { useAdminAnonLinks, useAdminLinks } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { AdminLinkRow, Sort } from "@/shared/types";
import { Badge, PageHeader, Table, Td, Th } from "../../ui/misc";
import { Button } from "../../ui/button";
import { Field, Input } from "../../ui/field";
import { Dialog } from "../../ui/dialog";
import { AdminTableSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { SearchInput } from "./search-input";
import { paginate } from "./util";
import { Pager } from "../../ui/pagination";
import { SortTh } from "../../ui/sort-th";
import { sortRows } from "../../lib/sort";
import { useSearchParams } from "react-router";
import { cn } from "../../ui/cn";

/**
 * Null is not zero. An unscored link is one nobody has looked at, and showing
 * it as "clean" is how a provider outage turns into a table of green ticks.
 */
function RiskBadge({ score, reasons }: { score: number | null; reasons: string[] }) {
  if (score === null) return <Badge color="muted">unscored</Badge>;
  if (score >= 100) return <Badge color="pink">{reasons.join(", ") || "blocked"}</Badge>;
  return <Badge color="mint">clean</Badge>;
}

function SuspendDialog({ link, onClose }: { link: AdminLinkRow | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const suspend = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api(`/admin/links/${input.id}/suspend`, {
        method: "POST",
        body: { reason: input.reason },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "links"] });
      await qc.invalidateQueries({ queryKey: ["admin", "audit"] });
      toast("Link suspended. It stops redirecting immediately.");
      setReason("");
      onClose();
    },
    onError: withErrorToast(toast),
  });

  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()} title="Suspend this link">
      {link && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface-2 p-3 text-xs">
            <p className="font-mono font-bold">/{link.slug}</p>
            <p className="mt-1 break-all text-muted">{link.destination}</p>
          </div>
          <p className="text-xs text-muted">
            The redirect stops at once and stays stopped, including after the owner edits the link.
            Nothing is deleted: the link and its clicks survive, and you can restore it.
          </p>
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Phishing report, ticket 412"
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || suspend.isPending}
              onClick={() => suspend.mutate({ id: link.id, reason: reason.trim() })}
            >
              Suspend link
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** One row. Its own component because a table row with two conditional
 * actions and a truncating cell is a component, not an expression. */
function LinkRow({
  link,
  onSuspend,
  onRestore,
}: {
  link: AdminLinkRow;
  onSuspend: (l: AdminLinkRow) => void;
  onRestore: { mutate: (id: string) => void; isPending: boolean };
}) {
  return (
    <tr className={link.suspendedAt ? "opacity-60" : undefined}>
      <Td>
        <span className="block truncate font-mono text-xs font-bold">
          {link.domain ?? ""}/{link.slug}
        </span>
        {link.suspendedAt && (
          <span className="mt-1 block">
            <Badge color="pink">suspended</Badge>
          </span>
        )}
      </Td>
      <Td className="truncate text-muted" title={link.destination}>
        {link.destination}
      </Td>
      <Td className="hidden truncate sm:table-cell">
        {/* Straight to that organization's links, which is the next question
            after "who owns this". */}
        <Link
          to={`/admin/links?org=${encodeURIComponent(link.orgId)}`}
          className="hover:text-accent hover:underline"
        >
          {link.orgName}
        </Link>
      </Td>
      <Td className="hidden sm:table-cell">
        <RiskBadge score={link.riskScore} reasons={link.riskReasons} />
      </Td>
      <Td className="hidden tnum sm:table-cell">{link.clicks}</Td>
      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">
        {shortDate(link.createdAt)}
      </Td>
      <Td>
        <LinkActions link={link} onSuspend={onSuspend} onRestore={onRestore} />
      </Td>
    </tr>
  );
}

function LinkActions({
  link,
  onSuspend,
  onRestore,
}: {
  link: AdminLinkRow;
  onSuspend: (l: AdminLinkRow) => void;
  onRestore: { mutate: (id: string) => void; isPending: boolean };
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <a href={link.destination} target="_blank" rel="noreferrer">
        <Button size="sm" variant="ghost" aria-label="Open destination">
          <ExternalLink size={13} />
        </Button>
      </a>
      {link.suspendedAt ? (
        <Button
          size="sm"
          variant="outline"
          disabled={onRestore.isPending}
          onClick={() => onRestore.mutate(link.id)}
        >
          <Undo2 size={13} /> Restore
        </Button>
      ) : (
        <Button size="sm" variant="danger" onClick={() => onSuspend(link)}>
          <Ban size={13} /> Suspend
        </Button>
      )}
    </div>
  );
}

function LinksTable({
  rows,
  onSuspend,
  sort,
  onSort,
}: {
  rows: AdminLinkRow[];
  onSuspend: (l: AdminLinkRow) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const unsuspend = useMutation({
    mutationFn: (id: string) => api(`/admin/links/${id}/unsuspend`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "links"] });
      await qc.invalidateQueries({ queryKey: ["admin", "audit"] });
      toast("Link restored.");
    },
    onError: withErrorToast(toast),
  });

  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted">No links match that search.</p>;

  return (
    // Fixed, with widths that add to 100%. In an auto-layout table a long
    // destination sets the column width and pushes everything past the card,
    // and `max-w` on the cell is ignored.
    <Table fixed>
      <thead>
        <tr>
          <SortTh
            label="Link"
            sortKey="slug"
            sort={sort}
            onSort={onSort}
            className="w-[26%] sm:w-[14%]"
          />
          {/* Hidden on a phone: seven columns in 390px squeezes every one of
              them into uselessness. The destination and the organization are
              the two an abuse report is read against, so they are the ones
              that survive the cut. */}
          <SortTh
            label="Destination"
            sortKey="destination"
            sort={sort}
            onSort={onSort}
            className="w-[34%] sm:w-[23%]"
          />
          <SortTh
            label="Organization"
            sortKey="orgName"
            sort={sort}
            onSort={onSort}
            className="hidden w-[14%] sm:table-cell"
          />
          <SortTh
            label="Risk"
            sortKey="riskScore"
            sort={sort}
            onSort={onSort}
            className="hidden w-[10%] sm:table-cell"
          />
          <SortTh
            label="Clicks"
            sortKey="clicks"
            sort={sort}
            onSort={onSort}
            className="hidden w-[7%] sm:table-cell"
          />
          <SortTh
            label="Created"
            sortKey="createdAt"
            sort={sort}
            onSort={onSort}
            className="hidden w-[12%] sm:table-cell"
          />
          <Th className="w-[40%] sm:w-[20%]" />
        </tr>
      </thead>
      <tbody>
        {rows.map((link) => (
          <LinkRow key={link.id} link={link} onSuspend={onSuspend} onRestore={unsuspend} />
        ))}
      </tbody>
    </Table>
  );
}

/** Links made on the landing page with no account. No org, no owner, and
 * they expire on their own, so deleting is the only action worth having. */
function AnonymousLinks() {
  const { data, isPending } = useAdminAnonLinks();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/links/anonymous/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "anon-links"] });
      toast("Anonymous link deleted.");
    },
    onError: withErrorToast(toast),
  });

  // Filtered here rather than on the server: the whole table is at most a
  // day of anonymous links, so it is already small enough to hold.
  const term = query.trim().toLowerCase();
  const all = sortRows(
    (data ?? []).filter(
      (link) =>
        !term ||
        link.slug.toLowerCase().includes(term) ||
        link.destination.toLowerCase().includes(term),
    ),
    sort,
    {
      slug: (l) => l.slug,
      destination: (l) => l.destination,
      riskScore: (l) => l.riskScore ?? -1,
      expiresAt: (l) => l.expiresAt,
      createdAt: (l) => l.createdAt,
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Made on the landing page without an account. They expire 24 hours after creation and
        disappear on their own; delete one to stop it sooner.
      </p>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Slug or destination"
        label="Search anonymous links"
      />
      {isPending ? (
        <AdminTableSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        <Table fixed>
          <thead>
            <tr>
              <SortTh
                label="Slug"
                sortKey="slug"
                sort={sort}
                onSort={setSort}
                className="w-[30%] sm:w-[18%]"
              />
              <SortTh
                label="Destination"
                sortKey="destination"
                sort={sort}
                onSort={setSort}
                className="w-[40%] sm:w-[38%]"
              />
              <SortTh
                label="Risk"
                sortKey="riskScore"
                sort={sort}
                onSort={setSort}
                className="hidden w-[14%] sm:table-cell"
              />
              <SortTh
                label="Expires"
                sortKey="expiresAt"
                sort={sort}
                onSort={setSort}
                className="hidden w-[14%] sm:table-cell"
              />
              <Th className="w-[30%] sm:w-[16%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((link) => (
              <tr key={link.id}>
                <Td className="truncate font-mono text-xs font-bold">/{link.slug}</Td>
                <Td className="truncate text-muted" title={link.destination}>
                  {link.destination}
                </Td>
                <Td className="hidden sm:table-cell">
                  <RiskBadge score={link.riskScore} reasons={link.riskReasons} />
                </Td>
                <Td className="hidden whitespace-nowrap text-muted sm:table-cell">
                  {shortDate(link.expiresAt)}
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(link.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

const VIEWS = [
  { id: "links", label: "Owned links" },
  { id: "anonymous", label: "Anonymous" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** Two sections, switched rather than stacked. Stacked, the anonymous list
 * sat below up to 200 link rows, which is the same as not being there. */
function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-surface-2 p-1">
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors",
            view === id ? "bg-surface font-bold text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The cross-org list with its own controls. Split out so the page itself is
 * just the switch and the two things it switches between. */
function OwnedLinks({ onSuspend }: { onSuspend: (l: AdminLinkRow) => void }) {
  const [params, setParams] = useSearchParams();
  const orgFilter = params.get("org") ?? "";
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const { data, isPending } = useAdminLinks({ q: query, suspended: suspendedOnly });

  const all = sortRows(
    (data ?? []).filter((link) => !orgFilter || link.orgId === orgFilter),
    sort,
    {
      slug: (l) => l.slug,
      destination: (l) => l.destination,
      orgName: (l) => l.orgName,
      // Unscored sorts below every score rather than as a zero: nobody has
      // looked at it, which is not the same as clean.
      riskScore: (l) => l.riskScore ?? -1,
      clicks: (l) => l.clicks,
      createdAt: (l) => l.createdAt,
    },
  );
  const { rows, totalPages, safePage } = paginate(all, page);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Slug or destination, e.g. phishy.example"
          label="Search links"
        />
        <Button
          size="sm"
          variant={suspendedOnly ? "primary" : "outline"}
          onClick={() => setSuspendedOnly((on) => !on)}
        >
          Suspended only
        </Button>
        {orgFilter && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              params.delete("org");
              setParams(params, { replace: true });
            }}
          >
            <X size={13} /> {all[0]?.orgName ?? "Organization"} only
          </Button>
        )}
      </div>
      {isPending ? (
        <AdminTableSkeleton />
      ) : (
        <LinksTable rows={rows} onSuspend={onSuspend} sort={sort} onSort={setSort} />
      )}
      <Pager page={safePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

export function AdminLinksPage() {
  const [view, setView] = useState<View>("links");
  const [suspending, setSuspending] = useState<AdminLinkRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Links"
        sub="Every link across every organization. Search by slug or destination."
      />

      <ViewSwitch view={view} onChange={setView} />

      {view === "links" && <OwnedLinks onSuspend={setSuspending} />}
      {view === "anonymous" && <AnonymousLinks />}

      <SuspendDialog link={suspending} onClose={() => setSuspending(null)} />
    </div>
  );
}
