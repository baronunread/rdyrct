import { useState } from "react";
import { Clock, Ellipsis, Info, Star, Trash2 } from "lucide-react";
import { useAddresses, useAddressMutations } from "../lib/hooks";
import { withErrorToast } from "../lib/mutation-toast";
import { useToast } from "../ui/toast";
import { Td } from "../ui/misc";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";
import { shortUrl } from "../lib/api";
import { shortDate } from "../lib/dates";
import { Spinner } from "../ui/spinner";
import { Tooltip } from "../ui/tooltip";
import { ConfirmDialog } from "../ui/confirm-dialog";
import type { AddressDTO, LinkDTO } from "@/shared/types";

// Permanent aliases before temp ones.
function addressRank(a: AddressDTO): number {
  return a.kind === "temp_alias" ? 1 : 0;
}

function timeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function AliasRow({
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
  const toast = useToast();
  const isTemp = address.kind === "temp_alias";

  return (
    <tr className="bg-surface-2/30">
      <Td className="py-1.5">
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <span className="w-5.5 shrink-0" />
          <span className="max-w-full truncate font-mono text-xs text-muted">/{address.slug}</span>
          <span className="shrink-0">
            <CopyButton
              text={shortUrl(address.slug, address.domain)}
              label={`Copy ${shortUrl(address.slug, address.domain)}`}
              onCopy={(text) => copyToClipboard(text, toast)}
            />
          </span>
        </div>
      </Td>
      <Td className="py-1.5 text-xs text-muted">
        {isTemp ? (
          <span className="inline-flex items-center gap-1">
            Expires in {timeLeft(address.expiresAt!)}
            <Tooltip content="Temporary redirects do not affect the link counter.">
              <button
                type="button"
                aria-label="About temporary aliases"
                className="cursor-help text-muted hover:text-text"
              >
                <Info size={12} />
              </button>
            </Tooltip>
          </span>
        ) : (
          "Permanent alias"
        )}
      </Td>
      <Td className="tnum py-1.5 text-right">{address.recentClicks}</Td>
      <Td className="py-1.5 text-xs whitespace-nowrap text-muted">
        {shortDate(address.createdAt)}
      </Td>
      <Td className="py-1.5">
        <Menu
          align="end"
          label={`Actions for ${address.slug}`}
          trigger={
            <div className="flex justify-end">
              <span className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text">
                <Ellipsis size={15} />
              </span>
            </div>
          }
        >
          {isTemp && (
            <MenuItem
              onClick={onKeepForever}
              className={pending ? "pointer-events-none opacity-50" : ""}
            >
              <Clock size={14} /> Keep forever
            </MenuItem>
          )}
          <MenuItem onClick={onPromote} className={pending ? "pointer-events-none opacity-50" : ""}>
            <Star size={14} /> Make primary
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            className={`text-danger ${pending ? "pointer-events-none opacity-50" : ""}`}
            onClick={onRemove}
          >
            <Trash2 size={14} /> Remove
          </MenuItem>
        </Menu>
      </Td>
    </tr>
  );
}

/** Expanded-row "thread" of a link's non-primary addresses, rendered as
 * regular table rows so they share the main table's columns and height. See #38. */
export function AliasThread({ orgId, link }: { orgId: string; link: LinkDTO }) {
  const addresses = useAddresses(orgId, link.id);
  const { keepForever, remove, promote } = useAddressMutations(orgId, link.id);
  const toast = useToast();
  const [removing, setRemoving] = useState<AddressDTO | null>(null);

  if (addresses.isLoading)
    return (
      <tr>
        <Td colSpan={5} className="bg-surface-2/30">
          <div className="flex justify-center py-1 text-muted">
            <Spinner />
          </div>
        </Td>
      </tr>
    );

  const aliases = (addresses.data ?? [])
    .filter((a) => a.kind !== "primary" && !a.retiredAt)
    .sort((a, b) => addressRank(a) - addressRank(b));
  if (!aliases.length) return null;

  const pending = keepForever.isPending || remove.isPending || promote.isPending;

  return (
    <>
      {aliases.map((address) => (
        <AliasRow
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
    </>
  );
}
