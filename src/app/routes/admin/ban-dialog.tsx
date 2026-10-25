import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { withErrorToast } from "../../lib/mutation-toast";
import { Button } from "../../ui/button";
import { Dialog } from "../../ui/dialog";
import { Field, Input } from "../../ui/field";
import { Skeleton } from "../../ui/skeleton";
import { BusyContent } from "../../ui/spinner";
import { useToast } from "../../ui/toast";
import { cn } from "../../ui/cn";

interface BanResult {
  orgsDisabled: number;
  hostsBlocked: number;
  subscriptionEnded: boolean;
}

/**
 * The one way to decide that a user is abuse, from the users list or from
 * one of their organizations. It says what happens before it happens.
 *
 * Blocking a host is opt-in, per host: most scam kits live on a throwaway
 * address that never comes back, and a blocked host is refused for every
 * customer. Sites everyone uses are listed but cannot be ticked.
 */
export function BanDialog({
  user,
  onClose,
}: {
  user: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()} title="Ban user">
      {/* Keyed so a second ban starts from an empty form. */}
      {user && <BanForm key={user.id} user={user} onClose={onClose} />}
    </Dialog>
  );
}

function BanForm({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const hosts = useQuery({
    queryKey: ["admin", "user-hosts", user.id],
    queryFn: () => api<{ host: string; blockable: boolean }[]>(`/admin/users/${user.id}/hosts`),
  });

  const ban = useMutation({
    mutationFn: () =>
      api<BanResult>(`/admin/users/${user.id}`, {
        method: "PATCH",
        body: { banned: true, reason: reason.trim(), blockHosts: [...picked] },
      }),
    onSuccess: async (done) => {
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast(
        [`${user.name} is banned.`, orgsLine(done.orgsDisabled), hostsLine(done.hostsBlocked)]
          .filter(Boolean)
          .join(" "),
      );
      if (!done.subscriptionEnded)
        toast("Polar did not cancel their subscription. Cancel it in Polar.", "error");
      onClose();
    },
    onError: withErrorToast(toast),
  });

  const toggle = (host: string, on: boolean) =>
    setPicked((set) => {
      const next = new Set(set);
      if (on) next.add(host);
      else next.delete(host);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Ban <span className="font-bold text-accent">{user.name}</span>? They are signed out now and
        cannot sign back in.
      </p>
      <ul className="list-disc pl-5 text-sm text-muted">
        <li>Every link in the organizations they own shows a page saying it is disabled.</li>
        <li>
          Those organizations are deleted in 90 days, with their links and clicks. Unbanning before
          then brings them back.
        </li>
        <li>A paid subscription is cancelled.</li>
      </ul>
      <Field label="Reason">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Phishing pages posing as PhonePe"
          autoFocus
        />
      </Field>
      <HostPicker hosts={hosts.data} loading={hosts.isPending} picked={picked} onToggle={toggle} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={!reason.trim() || ban.isPending}
          onClick={() => ban.mutate()}
        >
          <BusyContent busy={ban.isPending}>Ban user</BusyContent>
        </Button>
      </div>
    </div>
  );
}

function HostPicker({
  hosts,
  loading,
  picked,
  onToggle,
}: {
  hosts: { host: string; blockable: boolean }[] | undefined;
  loading: boolean;
  picked: ReadonlySet<string>;
  onToggle: (host: string, on: boolean) => void;
}) {
  if (loading)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  if (!hosts || hosts.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs text-muted">
        Also block for everyone (only if the site will come back)
      </legend>
      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
        {hosts.map(({ host, blockable }) => (
          <label
            key={host}
            className={cn("flex items-baseline gap-2 text-sm", !blockable && "text-muted")}
          >
            <input
              type="checkbox"
              disabled={!blockable}
              checked={picked.has(host)}
              onChange={(event) => onToggle(host, event.target.checked)}
            />
            <span className="min-w-0 font-mono break-words">{breakAtDots(host)}</span>
            {!blockable && <span className="shrink-0 text-xs text-muted">never blocked</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const orgsLine = (n: number) =>
  n === 1 ? "1 organization disabled." : `${n} organizations disabled.`;
const hostsLine = (n: number) =>
  n === 0 ? "" : n === 1 ? "1 host blocked." : `${n} hosts blocked.`;

/** A host with break opportunities before each dot, so a long one wraps at
 * ".up" rather than mid-word on a phone. */
const breakAtDots = (host: string) =>
  host.split(".").flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, `.${part}`]));
