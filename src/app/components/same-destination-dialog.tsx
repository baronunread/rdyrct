import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { shortUrl } from "../lib/api";
import type { LinkDTO } from "@/shared/types";

/**
 * Shown when creating a link whose destination (and UTM set) exactly matches
 * one already in the org (#38): offers to add the new address to that link
 * instead of silently forking a second one, or to create a separate link
 * anyway.
 */
export function SameDestinationDialog({
  matchedLink,
  onClose,
  onAddToExisting,
  onCreateSeparate,
  pending,
}: {
  matchedLink: LinkDTO | null;
  onClose: () => void;
  onAddToExisting: () => void;
  onCreateSeparate: () => void;
  pending: boolean;
}) {
  return (
    <Dialog
      open={!!matchedLink}
      onOpenChange={(o) => !o && onClose()}
      title="This destination already has a link"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          This destination already belongs to a link. Add this address to the same link so its
          settings and analytics stay together.
        </p>
        {matchedLink && (
          <p className="truncate rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">
            {shortUrl(matchedLink.slug, matchedLink.domain)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onCreateSeparate} disabled={pending}>
            Create separate link
          </Button>
          <Button variant="primary" onClick={onAddToExisting} disabled={pending}>
            Add to existing link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
