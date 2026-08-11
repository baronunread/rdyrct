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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, Trash2, Undo2 } from "lucide-react";
import { useAdminAnonLinks, useAdminAudit, useAdminLinks } from "../../lib/hooks";
import { api } from "../../lib/api";
import { ADMIN_LINK_SORTS, type AdminLinkRow, type AdminLinkSort } from "@/shared/types";
import { Badge, Card, PageHeader, Table, Td, Th } from "../../ui/misc";
import { Button } from "../../ui/button";
import { Field, Input, Select } from "../../ui/field";
import { Dialog } from "../../ui/dialog";
import { AdminTableSkeleton } from "../../components/skeletons";
import { useToast } from "../../ui/toast";
import { withErrorToast } from "../../lib/mutation-toast";
import { shortDate } from "../../lib/dates";
import { SearchInput } from "./search-input";

const SORT_LABELS: Record<AdminLinkSort, string> = {
  created: "Newest",
  clicks: "Most clicked",
  risk: "Riskiest first",
};

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
        <span className="font-mono text-xs font-bold">
          {link.domain ?? ""}/{link.slug}
        </span>
        {link.suspendedAt && (
          <span className="mt-1 block">
            <Badge color="pink">suspended</Badge>
          </span>
        )}
      </Td>
      <Td className="max-w-64 truncate text-muted" title={link.destination}>
        {link.destination}
      </Td>
      <Td>{link.orgName}</Td>
      <Td>
        <RiskBadge score={link.riskScore} reasons={link.riskReasons} />
      </Td>
      <Td className="tnum">{link.clicks}</Td>
      <Td className="text-muted">{shortDate(link.createdAt)}</Td>
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
}: {
  rows: AdminLinkRow[];
  onSuspend: (l: AdminLinkRow) => void;
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
    <Table>
      <thead>
        <tr>
          <Th>Link</Th>
          <Th>Destination</Th>
          <Th>Organization</Th>
          <Th>Risk</Th>
          <Th>Clicks</Th>
          <Th>Created</Th>
          <Th />
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

/** Card, label, and the "nothing here" case, which both lower sections need
 * and neither should spell out twice. */
function AdminSection({
  label,
  hint,
  empty,
  loading,
  children,
}: {
  label: string;
  hint?: string;
  empty: boolean;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3">
        <p className="text-2xs tracking-wider text-muted uppercase">{label}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {loading ? (
        <AdminTableSkeleton />
      ) : empty ? (
        <p className="py-4 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        children
      )}
    </Card>
  );
}

/** Links made on the landing page with no account. No org, no owner, and
 * they expire on their own, so deleting is the only action worth having. */
function AnonymousLinks() {
  const { data, isPending } = useAdminAnonLinks();
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

  const rows = data ?? [];

  return (
    <AdminSection
      label="Anonymous links"
      hint="Made on the landing page without an account. They expire 24 hours after creation and disappear on their own; delete one to stop it sooner."
      loading={isPending}
      empty={rows.length === 0}
    >
      <Table>
        <thead>
          <tr>
            <Th>Slug</Th>
            <Th>Destination</Th>
            <Th>Risk</Th>
            <Th>Expires</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((link) => (
            <tr key={link.id}>
              <Td className="font-mono text-xs font-bold">/{link.slug}</Td>
              <Td className="max-w-64 truncate text-muted" title={link.destination}>
                {link.destination}
              </Td>
              <Td>
                <RiskBadge score={link.riskScore} reasons={link.riskReasons} />
              </Td>
              <Td className="text-muted">{shortDate(link.expiresAt)}</Td>
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
    </AdminSection>
  );
}

/** The audit trail, so a suspension is answerable later. */
function AuditLog() {
  const { data, isPending } = useAdminAudit();
  const rows = data ?? [];

  return (
    <AdminSection label="Recent admin actions" loading={isPending} empty={rows.length === 0}>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Target</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id}>
              <Td className="text-muted">{shortDate(entry.createdAt)}</Td>
              {/* The address may be gone: the log outlives the account. */}
              <Td>{entry.actorEmail ?? <span className="text-muted">deleted account</span>}</Td>
              <Td className="font-mono text-xs">{entry.action}</Td>
              <Td className="max-w-64 truncate text-muted" title={entry.detail ?? entry.targetId}>
                {entry.detail ?? entry.targetId}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminSection>
  );
}

export function AdminLinksPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AdminLinkSort>("created");
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [suspending, setSuspending] = useState<AdminLinkRow | null>(null);

  const { data, isPending } = useAdminLinks({ q: query, sort, suspended: suspendedOnly });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Links"
        sub="Every link across every organization. Search by slug or destination."
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Slug or destination, e.g. phishy.example"
            label="Search links"
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as AdminLinkSort)}
            wrapperClass="w-44"
          >
            {ADMIN_LINK_SORTS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant={suspendedOnly ? "primary" : "outline"}
            onClick={() => setSuspendedOnly((on) => !on)}
          >
            Suspended only
          </Button>
        </div>
        {isPending ? (
          <AdminTableSkeleton />
        ) : (
          <LinksTable rows={data ?? []} onSuspend={setSuspending} />
        )}
      </Card>

      <AnonymousLinks />
      <AuditLog />

      <SuspendDialog link={suspending} onClose={() => setSuspending(null)} />
    </div>
  );
}
