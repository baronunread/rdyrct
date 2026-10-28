import { useState } from "react";
import { Clock, Ellipsis, Info, Star, Trash2 } from "@/app/ui/icons";
// m.tr renders inside a LazyMotion provider set up by the caller (LinksTable).
import { m } from "motion/react";
import { useAddresses, useAddressMutations } from "../lib/hooks";
import { withErrorToast } from "../lib/mutation-toast";
import { useToast } from "../ui/toast";
import { Td } from "../ui/misc";
import { ShortAddress } from "./short-address";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";
import { tableDate } from "../lib/links-data";
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
    // The link's own columns, so an alias lines up under its link: the
    // checkbox column left empty (aliases go with their link), address over
    // what kind of alias it is, the shared destination, its clicks (a
    // week's, said so), when it was made, and its menu.
    <m.tr
      className="bg-surface-2/40"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Td className="hidden pr-0 sm:table-cell" />
      <Td className="py-2 max-sm:pl-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Under the link's QR thumbnail: a rule that ties the row to it. */}
          <span aria-hidden className="flex w-8 shrink-0 justify-center self-stretch sm:w-7">
            <span className="w-px bg-border" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1">
              <ShortAddress url={address.url} slug={address.slug} />
              <CopyButton
                text={address.url}
                label={`Copy ${address.url}`}
                onCopy={(text) => copyToClipboard(text, toast)}
              />
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              {isTemp ? (
                <>
                  Temporary alias · expires in {timeLeft(address.expiresAt!)}
                  <Tooltip content="Temporary redirects do not count toward your plan's links.">
                    <button
                      type="button"
                      aria-label="About temporary aliases"
                      className="relative cursor-help text-muted after:absolute after:-inset-1.5 [@media(hover:hover)]:hover:text-text"
                    >
                      <Info size={12} />
                    </button>
                  </Tooltip>
                </>
              ) : (
                "Permanent alias"
              )}
            </span>
          </div>
        </div>
      </Td>
      <Td className="hidden py-2 text-xs text-muted lg:table-cell">Same destination</Td>
      <Td className="hidden xl:table-cell" />
      <Td className="py-2 text-end">
        <span className="tnum block font-semibold">
          {address.recentClicks.toLocaleString("en-US")}
        </span>
        <span className="block text-xs text-muted">7 days</span>
      </Td>
      <Td className="hidden py-2 text-xs whitespace-nowrap text-muted sm:table-cell">
        {tableDate(address.createdAt)}
      </Td>
      <Td className="py-2 pr-2 pl-0">
        <Menu
          align="end"
          label={`Actions for ${address.slug}`}
          trigger={
            <div className="flex justify-end">
              <span className="grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text">
                <Ellipsis size={16} />
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
      // One cell per column the table draws at this width: Link, Clicks and
      // the menu always, the checkbox and Created from sm, Destination from
      // lg and Last 14 days from xl. A span
      // asking for a column the table does not have makes the browser add
      // one, and the header jumps while the aliases load.
      <tr>
        <Td colSpan={3} className="bg-surface-2/40">
          <SkeletonStatus className="flex justify-center py-1">
            <Skeleton className="h-4 w-32" />
          </SkeletonStatus>
        </Td>
        <Td className="hidden bg-surface-2/40 sm:table-cell" />
        <Td className="hidden bg-surface-2/40 sm:table-cell" />
        <Td className="hidden bg-surface-2/40 lg:table-cell" />
        <Td className="hidden bg-surface-2/40 xl:table-cell" />
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
            <p className="max-w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs wrap-break-word">
              {removing.url}
            </p>
            <p>will stop resolving immediately. This can't be undone.</p>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
