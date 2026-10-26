import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "@/app/ui/icons";
import type { AdminBlockedHostRow } from "@/shared/types";
import { api } from "../../lib/api";
import { shortDate } from "../../lib/dates";
import { useAdminBlockedHosts } from "../../lib/hooks";
import { withErrorToast } from "../../lib/mutation-toast";
import { Button } from "../../ui/button";
import { Field, Input } from "../../ui/field";
import { Table, Td, Th } from "../../ui/misc";
import { Spinner } from "../../ui/spinner";
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
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Host" className="w-64">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="scam.example.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Reason" className="w-72">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Phishing kit, report #412"
          />
        </Field>
        <Button type="submit" disabled={!host.trim() || !reason.trim() || add.isPending}>
          {add.isPending && <Spinner />} Block host
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
          <Th className="w-[10%]" />
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.host}>
            <Td className="truncate font-mono text-xs font-bold">{h.host}</Td>
            <Td className="truncate text-muted" title={h.reason}>
              {h.reason || "none"}
            </Td>
            <Td className="whitespace-nowrap text-muted">{shortDate(h.createdAt)}</Td>
            <Td>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Unblock ${h.host}`}
                disabled={pending}
                onClick={() => onRemove(h.host)}
              >
                <Trash2 size={14} />
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
