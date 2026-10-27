import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "@/app/ui/icons";
import type { AdminBlockedHostRow } from "@/shared/types";
import { api } from "../../lib/api";
import { shortDate } from "../../lib/dates";
import { useAdminBlockedHosts } from "../../lib/hooks";
import { withErrorToast } from "../../lib/mutation-toast";
import { Button, IconButton } from "../../ui/button";
import { Field, Input } from "../../ui/field";
import { Table, Td, Th } from "../../ui/misc";
import { BusyContent } from "../../ui/spinner";
import { TableSkeleton } from "../../ui/skeleton";
import { useToast } from "../../ui/toast";

/** Destination hosts nobody may link to. Fed by a ban (only the hosts the
 * admin picks), and by hand here. Listed with a way to remove an entry, because a blocklist with no
 * way out turns one mistake into a permanent outage for a legitimate site. */
export function BlockedHosts() {
  const { data, isPending } = useAdminBlockedHosts();
  const toast = useToast();
  const qc = useQueryClient();
  const [host, setHost] = useState("");
  const [reason, setReason] = useState("");
  // Which fields the last submit found empty. Cleared field by field as
  // each gets a value.
  const [missing, setMissing] = useState({ host: false, reason: false });
  const hostRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "blocked-hosts"] });

  const add = useMutation({
    mutationFn: () => api("/admin/links/blocked-hosts", { method: "POST", body: { host, reason } }),
    onSuccess: async () => {
      await refresh();
      setHost("");
      setReason("");
      toast("Host blocked.");
    },
    onError: withErrorToast(toast),
  });
  const remove = useMutation({
    mutationFn: (h: string) =>
      api(`/admin/links/blocked-hosts/${encodeURIComponent(h)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      toast("Host unblocked.");
    },
    onError: withErrorToast(toast),
  });

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Both are required. The button stays live and says which one is
          // missing, rather than greying out with no word as to why.
          const next = { host: !host.trim(), reason: !reason.trim() };
          setMissing(next);
          if (next.host) return hostRef.current?.focus();
          if (next.reason) return reasonRef.current?.focus();
          add.mutate();
        }}
      >
        <Field label="Host" className="w-64" error={missing.host ? "Required" : undefined}>
          <Input
            ref={hostRef}
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              if (e.target.value.trim()) setMissing((m) => ({ ...m, host: false }));
            }}
            placeholder="scam.example.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Reason" className="w-72" error={missing.reason ? "Required" : undefined}>
          <Input
            ref={reasonRef}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setMissing((m) => ({ ...m, reason: false }));
            }}
            placeholder="Phishing kit, report #412"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={add.isPending}>
          <BusyContent busy={add.isPending}>Block host</BusyContent>
        </Button>
      </form>

      <BlockedTable
        rows={data}
        isPending={isPending}
        pending={remove.isPending}
        onRemove={remove.mutate}
      />
    </div>
  );
}

function BlockedTable({
  rows,
  isPending,
  pending,
  onRemove,
}: {
  rows: AdminBlockedHostRow[] | undefined;
  isPending: boolean;
  pending: boolean;
  onRemove: (host: string) => void;
}) {
  if (isPending) return <TableSkeleton rows={3} testId="admin-blocked-rows-skeleton" />;
  if (!rows || rows.length === 0)
    return (
      <p className="py-6 text-center text-sm text-muted">
        No blocked hosts. Banning a user can add the hosts their links used.
      </p>
    );
  return (
    <Table fixed minWidth="min-w-[48rem]">
      <thead>
        <tr>
          <Th className="w-[34%]">Host</Th>
          <Th className="w-[40%]">Reason</Th>
          <Th className="w-[16%]">Blocked</Th>
          <Th className="w-14 px-2">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.host}>
            <Td className="truncate font-mono text-sm font-semibold" title={h.host}>
              {h.host}
            </Td>
            <Td className="truncate text-muted" title={h.reason}>
              {h.reason || "None given"}
            </Td>
            <Td className="tnum text-xs whitespace-nowrap text-muted">{shortDate(h.createdAt)}</Td>
            <Td className="px-2 text-right">
              <IconButton
                label={`Unblock ${h.host}`}
                danger
                disabled={pending}
                onClick={() => onRemove(h.host)}
                className="size-8"
              >
                <Trash2 size={15} />
              </IconButton>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
