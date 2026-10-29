import { useState, type FormEvent } from "react";
import { useHeld } from "../lib/use-held";
import type { LinkDTO } from "@/shared/types";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { useLinkMutations } from "../lib/hooks";
import { ApiError } from "../lib/api";
import { addressOf } from "../lib/links-data";
import posthog from "../lib/posthog";

const n = (v: number) => v.toLocaleString("en-US");

/** What deleting costs, said before it happens: the code on paper stops too,
 * and the history goes with it. */
function warning(links: LinkDTO[]): string {
  const clicks = links.reduce((sum, link) => sum + link.clicks, 0);
  if (links.length === 1) {
    const history =
      clicks === 0
        ? "It has no clicks yet."
        : `Its ${n(clicks)} ${clicks === 1 ? "click" : "clicks"} of history go with it.`;
    return `The short link and its QR code stop working at once, including printed copies. ${history} This can't be undone.`;
  }
  const history =
    clicks === 0
      ? "They have no clicks yet."
      : `Their ${n(clicks)} ${clicks === 1 ? "click" : "clicks"} of history go with them.`;
  return `These short links and their QR codes stop working at once, including printed copies. ${history} This can't be undone.`;
}

/**
 * The delete confirmation, for one link from its row menu or the editor, or
 * for the rows ticked in the table.
 *
 * A plain confirmation: the dialog names the link and says what goes with
 * it. Typing a name to confirm is kept for deleting a whole organization.
 */
export function DeleteLinkDialog({
  orgId,
  links,
  onClose,
  onDeleted,
}: {
  orgId: string;
  /** The links to delete; null or empty keeps the dialog closed. */
  links: LinkDTO[] | null;
  onClose: () => void;
  /** After every one of them is gone, with their ids. */
  onDeleted?: (ids: string[]) => void;
}) {
  const open = !!links && links.length > 0;
  // Kept through the close animation, so the title does not blank out.
  const shown = useHeld(open ? links : null) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={
        shown.length === 1 ? `Delete ${addressOf(shown[0])}?` : `Delete ${n(shown.length)} links?`
      }
    >
      {open && (
        <DeleteForm
          key={shown.map((l) => l.id).join()}
          orgId={orgId}
          links={shown}
          onClose={onClose}
          onDeleted={onDeleted}
        />
      )}
    </Dialog>
  );
}

function DeleteForm({
  orgId,
  links,
  onClose,
  onDeleted,
}: {
  orgId: string;
  links: LinkDTO[];
  onClose: () => void;
  onDeleted?: (ids: string[]) => void;
}) {
  const toast = useToast();
  const { remove } = useLinkMutations(orgId);
  const [busy, setBusy] = useState(false);
  const single = links.length === 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const done: string[] = [];
    try {
      // One at a time: each delete answers with the quota it leaves, and
      // the cache keeps the freshest of them.
      for (const link of links) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- one at a time on purpose, see above.
        await remove.mutateAsync(link.id);
        done.push(link.id);
        posthog.capture("link_deleted", { had_custom_domain: link.domainId !== null });
      }
      toast(single ? "Link deleted" : `${n(done.length)} links deleted`);
      onDeleted?.(done);
      onClose();
    } catch (e) {
      const why = e instanceof ApiError ? e.message : "Something went wrong";
      toast(done.length ? `Deleted ${n(done.length)} of ${n(links.length)}. ${why}` : why, "error");
      if (done.length) onDeleted?.(done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-pretty text-muted">{warning(links)}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="danger"
          disabled={busy}
          className="bg-danger font-semibold text-bg shadow-none [@media(hover:hover)]:hover:bg-danger [@media(hover:hover)]:hover:brightness-110"
        >
          <BusyContent busy={busy}>
            {single ? "Delete link" : `Delete ${n(links.length)} links`}
          </BusyContent>
        </Button>
      </div>
    </form>
  );
}
