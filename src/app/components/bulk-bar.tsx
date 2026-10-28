import { IconQrcode, IconTrash, IconX } from "@tabler/icons-react";
import { Spinner } from "../ui/spinner";
import { cn } from "../ui/cn";

const ACTION =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.97] disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bg [@media(hover:hover)]:hover:bg-bg/10";

/**
 * What to do with the ticked rows. It takes the toolbar's place while
 * anything is ticked, at the toolbar's height, so ticking a box never moves
 * the table: the search and filters come back as soon as the selection
 * clears.
 *
 * Ink on paper inverted (the one dark strip on the page) because it is a
 * mode: everything on it acts on the selection, not on the table.
 */
export function BulkBar({
  count,
  onDownloadQr,
  downloading,
  onDelete,
  onClear,
}: {
  count: number;
  onDownloadQr: () => void;
  downloading: boolean;
  /** Undefined for somebody who cannot delete (a viewer, a read-only org). */
  onDelete?: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected links"
      className="flex h-11 items-center gap-1 rounded-xl bg-text py-1.5 pr-1.5 pl-2 text-sm text-bg"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(ACTION, "w-8 justify-center px-0")}
      >
        <IconX size={15} stroke={2} aria-hidden />
      </button>
      <span className="tnum" aria-live="polite">
        <b className="font-semibold">{count.toLocaleString("en-US")}</b> selected
      </span>
      <span className="flex-1" />
      <button type="button" onClick={onDownloadQr} disabled={downloading} className={ACTION}>
        {downloading ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconQrcode size={15} stroke={1.75} aria-hidden />
        )}
        <span className="max-sm:hidden">Download QR codes</span>
        <span className="sm:hidden">QR codes</span>
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} className={ACTION}>
          <IconTrash size={15} stroke={1.75} aria-hidden /> Delete
        </button>
      )}
    </div>
  );
}
