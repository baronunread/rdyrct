import { useState } from "react";
import { Clock, Ellipsis, Info, Star, Trash2 } from "lucide-react";
// m.tr renders inside a LazyMotion provider set up by the caller (LinksTable).
import { m } from "motion/react";
import { useAddresses, useAddressMutations } from "../lib/hooks";
import { withErrorToast } from "../lib/mutation-toast";
import { useToast } from "../ui/toast";
import { Slug, Td } from "../ui/misc";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";
import { shortUrl } from "../lib/api";
import { shortDate } from "../lib/dates";
import { Skeleton, SkeletonStatus } from "../ui/skeleton";
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
    <m.tr
      className="bg-surface-2/30"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 2 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Td className="py-1.5">
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <span className="w-5.5 shrink-0" />
          <Slug slug={address.slug} className="font-mono text-xs text-muted" />
          <span className="shrink-0">
            <CopyButton
              text={shortUrl(address.slug, address.domain)}
              label={`Copy ${shortUrl(address.slug, address.domain)}`}
              onCopy={(text) => copyToClipboard(text, toast)}
            />
          </span>
        </div>
      </Td>
      <Td className="hidden py-1.5 text-xs text-muted lg:table-cell">—</Td>
      <Td className="hidden py-1.5 text-xs text-muted xl:table-cell">
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
      <Td className="tnum py-1.5 text-end">{address.recentClicks}</Td>
      <Td className="hidden py-1.5 text-xs whitespace-nowrap text-muted sm:table-cell">
        {shortDate(address.createdAt)}
      </Td>
      <Td className="py-1.5">
        <Menu
          align="end"
          label={`Actions for ${address.slug}`}
          trigger={
            <div className="flex justify-end">
              <span className="rounded p-1.5 text-muted transition-transform duration-150 active:scale-[0.96] hover:bg-surface-2 hover:text-text">
                <Ellipsis size={15} />
              </span>
            </div>
          }
        >
          {isTemp && (
            <MenuItem onClick={onKeepForever} disabled={pending}>
              <Clock size={14} /> Keep forever
            </MenuItem>
          )}
          <MenuItem onClick={onPromote} disabled={pending}>
            <Star size={14} /> Make primary
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-danger" onClick={onRemove} disabled={pending}>
            <Trash2 size={14} /> Remove
          </MenuItem>
        </Menu>
      </Td>
    </m.tr>
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
      // The span has to match how many columns are actually rendered, and
      // that changes with the viewport: the table hides Title below lg and
      // Destination below xl, and a hidden cell creates no column at all.
      // A flat colSpan={6} asked for a column that did not exist, so the
      // browser made one and squeezed the real ones to fit: the header
      // visibly jumped while the aliases loaded and snapped back after.
      //
      // Three is the count that is always there (Short link, Clicks,
      // Actions); the three trailing cells appear exactly when their columns
      // do.
      <tr>
        <Td colSpan={3} className="bg-surface-2/30">
          <SkeletonStatus className="flex justify-center py-1">
            <Skeleton className="h-4 w-32" />
          </SkeletonStatus>
        </Td>
        <Td className="hidden bg-surface-2/30 sm:table-cell" />
        <Td className="hidden bg-surface-2/30 lg:table-cell" />
        <Td className="hidden bg-surface-2/30 xl:table-cell" />
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
          <div className="flex flex-col gap-2">
            <p
              className="max-w-full truncate rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs"
              title={shortUrl(removing.slug, removing.domain)}
            >
              {shortUrl(removing.slug, removing.domain)}
            </p>
            <p>will stop resolving immediately. This can't be undone.</p>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
