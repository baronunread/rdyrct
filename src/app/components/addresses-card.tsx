import { useState } from "react";
import { useAddresses, useAddressMutations } from "../lib/hooks";
import { shortUrl } from "../lib/api";
import { shortDate } from "../lib/dates";
import { withErrorToast } from "../lib/mutation-toast";
import { useToast } from "../ui/toast";
import { Badge, Card } from "../ui/misc";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import type { AddressDTO } from "@/shared/types";

// Primary first, then permanent aliases, then temp aliases, then expired/removed.
function addressRank(a: AddressDTO): number {
  return a.retiredAt ? 3 : a.kind === "primary" ? 0 : a.kind === "permanent_alias" ? 1 : 2;
}

function timeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function kindBadge(address: AddressDTO) {
  if (address.retiredAt) return <Badge color="muted">Expired</Badge>;
  if (address.kind === "primary") return <Badge color="accent">Primary</Badge>;
  if (address.kind === "temp_alias")
    return <Badge color="butter">Expires in {timeLeft(address.expiresAt!)}</Badge>;
  return <Badge color="mint">Permanent alias</Badge>;
}

function AddressRow({
  address,
  onKeepForever,
  onRemove,
  onPromote,
  pending,
}: {
  address: AddressDTO;
  onKeepForever: () => void;
  onRemove: () => void;
  onPromote: () => void;
  pending: boolean;
}) {
  const isTemp = address.kind === "temp_alias" && !address.retiredAt;
  const isActive = !address.retiredAt;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-xs text-text">
          {shortUrl(address.slug, address.domain)}
        </p>
        {kindBadge(address)}
      </div>

      {isTemp && (
        <p className="text-xs text-muted">
          This address expires in {timeLeft(address.expiresAt!)}. Check where its clicks come from
          before it stops working.
        </p>
      )}

      {isActive && address.kind !== "primary" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-3xs tracking-wide text-muted uppercase">
          <span>{address.recentClicks} clicks · 7d</span>
          <span>Last use: {address.lastUse ? shortDate(address.lastUse) : "never"}</span>
          {address.referrers.length > 0 && (
            <span>Top referrer: {address.referrers[0].key || "direct"}</span>
          )}
        </div>
      )}

      {isActive && address.kind !== "primary" && (
        <div className="mt-1 flex flex-wrap gap-2">
          {isTemp && (
            <Button variant="outline" size="sm" onClick={onKeepForever} disabled={pending}>
              Keep forever
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onPromote} disabled={pending}>
            Make primary
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={pending}>
            Remove now
          </Button>
        </div>
      )}
    </div>
  );
}

export function AddressesCard({ orgId, linkId }: { orgId: string; linkId: string }) {
  const addresses = useAddresses(orgId, linkId);
  const { keepForever, remove, promote } = useAddressMutations(orgId, linkId);
  const toast = useToast();
  const [removing, setRemoving] = useState<AddressDTO | null>(null);

  if (addresses.isLoading) return null;
  const rows = addresses.data ?? [];
  if (!rows.length) return null;

  const sorted = [...rows].sort((a, b) => addressRank(a) - addressRank(b));

  const pending = keepForever.isPending || remove.isPending || promote.isPending;

  return (
    <Card>
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Addresses</p>
      <div className="flex flex-col gap-2">
        {sorted.map((address) => (
          <AddressRow
            key={address.id}
            address={address}
            pending={pending}
            onKeepForever={() =>
              keepForever.mutate(address.id, {
                onSuccess: () => toast("Address kept forever"),
                onError: withErrorToast(toast),
              })
            }
            onPromote={() =>
              promote.mutate(address.id, {
                onSuccess: () => toast("Primary address updated"),
                onError: withErrorToast(toast),
              })
            }
            onRemove={() => setRemoving(address)}
          />
        ))}
      </div>

      <ConfirmDialog
        title="Remove this address?"
        open={!!removing}
        onClose={() => setRemoving(null)}
        danger
        pending={remove.isPending}
        confirmLabel="Remove now"
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast("Address removed");
              setRemoving(null);
            },
            onError: withErrorToast(toast),
          });
        }}
      >
        {removing && (
          <>
            <span className="font-mono">{shortUrl(removing.slug, removing.domain)}</span> will stop
            resolving immediately. This can't be undone.
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
