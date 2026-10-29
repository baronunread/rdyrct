import { useState } from "react";
import { Clock, Copy, Ellipsis, Star, Trash2 } from "@/app/ui/icons";
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
import { shortDate } from "../lib/dates";
import { tableDate } from "../lib/links-data";
import { Skeleton, SkeletonStatus } from "../ui/skeleton";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cn } from "../ui/cn";
import type { AddressDTO, LinkDTO } from "@/shared/types";

const HOUR = 60 * 60 * 1000;

/** Temporary aliases first, since each asks for a decision before it runs
 * out; then the newest first. */
function byUrgency(a: AddressDTO, b: AddressDTO): number {
  const temp = Number(b.kind === "temp_alias") - Number(a.kind === "temp_alias");
  return temp || b.createdAt - a.createdAt;
}

/** "30h left" under two days, so the last day and a half is not all "2d";
 * "5d left" beyond that. */
export function timeLeft(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "Expired";
  const hours = Math.ceil(ms / HOUR);
  return hours < 48 ? `${hours}h left` : `${Math.floor(hours / 24)}d left`;
}

/** 32px to look like the link's own menu, 40px to hit (the ::after). */
const ICON =
  "relative grid size-8 place-items-center rounded-md text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] after:absolute after:-inset-1 [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text";

/** Shown on hover or focus where there is hover; always on a touch screen. */
const REVEAL =
  "[@media(hover:hover)]:sm:opacity-0 [@media(hover:hover)]:sm:group-hover:opacity-100 [@media(hover:hover)]:sm:group-focus-within:opacity-100";

function AliasRow({
  address,
  linkDomain,
  last,
  onKeep,
  onRemove,
  onPromote,
  pending,
}: {
  address: AddressDTO;
  /** The link's own custom domain, or null for the shared one. */
  linkDomain: string | null;
  last: boolean;
  onKeep: () => void;
  onRemove: () => void;
  onPromote: () => void;
  pending: boolean;
}) {
  const toast = useToast();
  const temp = address.kind === "temp_alias" && address.expiresAt !== null;
  const copy = () => copyToClipboard(address.url, toast);
  const clicks = address.recentClicks;

  return (
    // One row per alias on the link's own columns (styles.css draws the
    // tree): the slug under the link's title, the host only when it is not
    // the link's, a temporary alias's time left and Keep, its week's clicks
    // when it has any, the day it was added, and its actions.
    <m.tr
      className={cn("alias-row group", last && "alias-row-last")}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Td className="alias-tree-check hidden p-0 sm:table-cell" />
      <Td className="alias-tree-link py-1.5 max-sm:py-1">
        <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 max-sm:min-h-8">
          <ShortAddress
            url={address.url}
            slug={address.slug}
            hideHost={address.domain === linkDomain}
            slugClassName="text-text"
          />
          {temp && (
            <>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-butter"
                title={`Temporary. Stops working ${shortDate(address.expiresAt!)}.`}
              >
                <Clock size={12} aria-hidden />
                {timeLeft(address.expiresAt!)}
              </span>
              <button
                type="button"
                onClick={onKeep}
                disabled={pending}
                aria-label={`Keep ${address.slug} for good`}
                className="relative -mx-0.5 -my-1 shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-xs font-semibold text-accent transition-[background-color] duration-150 after:absolute after:-inset-1.5 disabled:cursor-default disabled:opacity-50 [@media(hover:hover)]:enabled:hover:bg-accent/12"
              >
                Keep
              </button>
            </>
          )}
        </div>
      </Td>
      <Td className="hidden lg:table-cell" />
      <Td className="hidden xl:table-cell" />
      <Td
        className="tnum py-1.5 text-end text-[13px] whitespace-nowrap text-muted max-sm:px-1"
        title={`${clicks.toLocaleString("en-US")} click${clicks === 1 ? "" : "s"} in the last 7 days`}
      >
        {clicks > 0 && clicks.toLocaleString("en-US")}
      </Td>
      <Td className="tnum hidden py-1.5 text-[12.5px] whitespace-nowrap text-muted sm:table-cell">
        {tableDate(address.createdAt)}
      </Td>
      <Td className="py-1 pr-2 pl-0 max-sm:py-0">
        <div className="flex items-center justify-end gap-0.5">
          <span className={cn("max-sm:hidden", REVEAL)}>
            <CopyButton text={address.url} label={`Copy ${address.url}`} onCopy={copy} />
          </span>
          <span
            className={cn(
              "w-8",
              REVEAL,
              "[@media(hover:hover)]:sm:has-[[aria-expanded=true]]:opacity-100",
            )}
          >
            <Menu
              align="end"
              label={`Actions for ${address.slug}`}
              trigger={
                <span className={ICON}>
                  <Ellipsis size={16} aria-hidden />
                </span>
              }
            >
              <MenuItem onClick={() => void copy()}>
                <Copy size={14} aria-hidden /> Copy address
              </MenuItem>
              {temp && (
                <MenuItem onClick={onKeep} disabled={pending}>
                  <Clock size={14} aria-hidden /> Keep for good
                </MenuItem>
              )}
              <MenuItem onClick={onPromote} disabled={pending}>
                <Star size={14} aria-hidden /> Make primary
              </MenuItem>
              <MenuSeparator />
              <MenuItem className="text-danger" onClick={onRemove} disabled={pending}>
                <Trash2 size={14} aria-hidden /> Remove
              </MenuItem>
            </Menu>
          </span>
        </div>
      </Td>
    </m.tr>
  );
}

/** A link's other addresses, as tree rows under it on the table's own
 * columns, so each shares the link's row height and alignment. See #38. */
export function AliasThread({ orgId, link }: { orgId: string; link: LinkDTO }) {
  const addresses = useAddresses(orgId, link.id);
  const { keepForever, remove, promote } = useAddressMutations(orgId, link.id);
  const toast = useToast();
  const [removing, setRemoving] = useState<AddressDTO | null>(null);

  if (addresses.isLoading)
    return (
      // The same cells as an alias row, one per column the table draws at
      // this width. A span asking for a column the table does not have
      // makes the browser add one, and the header jumps while they load.
      <tr className="alias-row alias-row-last">
        <Td className="alias-tree-check hidden p-0 sm:table-cell" />
        <Td className="alias-tree-link py-1.5">
          <SkeletonStatus className="flex min-h-7 items-center">
            <Skeleton className="h-4 w-32" />
          </SkeletonStatus>
        </Td>
        <Td className="hidden lg:table-cell" />
        <Td className="hidden xl:table-cell" />
        <Td />
        <Td className="hidden sm:table-cell" />
        <Td />
      </tr>
    );

  const aliases = (addresses.data ?? [])
    .filter((a) => a.kind !== "primary" && !a.retiredAt)
    .sort(byUrgency);
  if (!aliases.length) return null;

  const pending = keepForever.isPending || remove.isPending || promote.isPending;

  return (
    <>
      {aliases.map((address, i) => (
        <AliasRow
          key={address.id}
          address={address}
          linkDomain={link.domain}
          last={i === aliases.length - 1}
          pending={pending}
          onKeep={() =>
            keepForever.mutate(address.id, {
              onSuccess: () => toast(`Kept ${address.slug}`),
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
