import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { withErrorToast } from "../../lib/mutation-toast";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { Field, Input } from "../../ui/field";
import { useToast } from "../../ui/toast";

/**
 * The verdict that an organization is abuse. It does three things at once,
 * and says so before it does them: doing only the first leaves the second and
 * third for the next signup.
 */
export function AbuseDialog({
  org,
  onClose,
}: {
  org: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const mark = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api<{ links: number; hostsBlocked: number }>(`/admin/links/orgs/${input.id}/abuse`, {
        method: "POST",
        body: { reason: input.reason },
      }),
    onSuccess: async (done) => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast(`Marked as abuse. ${done.links} links stopped, ${done.hostsBlocked} hosts blocked.`);
      setReason("");
      onClose();
    },
    onError: withErrorToast(toast),
  });

  return (
    <Dialog open={!!org} onOpenChange={(open) => !open && onClose()} title="Mark as abuse">
      {org && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-bold text-accent">{org.name}</span> will:
          </p>
          <ul className="list-disc pl-5 text-sm text-muted">
            <li>stop all its links now (suspended, and you can restore them)</li>
            <li>ban its owner and end their sessions</li>
            <li>block every destination host its links point to, for everyone</li>
          </ul>
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Spin-to-win scam on a PhonePe look-alike"
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || mark.isPending}
              onClick={() => mark.mutate({ id: org.id, reason: reason.trim() })}
            >
              Mark as abuse
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
