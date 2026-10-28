import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LinkDTO } from "@/shared/types";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
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
 * Typing the slug (or "delete" for several) is the confirmation, because the
 * button sits where a hurried click lands and a printed QR code cannot be
 * reprinted. A mismatch marks the field and says so in its label row; the
 * button stays enabled so a wrong guess is explained rather than ignored.
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
  const [retained, setRetained] = useState<LinkDTO[]>([]);
  useEffect(() => {
    if (links && links.length > 0) setRetained(links);
  }, [links]);
  const shown = links && links.length > 0 ? links : retained;

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
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const single = links.length === 1;
  const expected = single ? links[0].slug : "delete";

  // The dialog focuses its first control (the close button) as it opens;
  // the field is where the next keystroke belongs.
  useEffect(() => {
    const id = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim() !== expected) {
      setError(typed.trim() ? "Doesn't match" : "Required");
      input.current?.focus();
      return;
    }
    setBusy(true);
    const done: string[] = [];
    try {
      // One at a time: each delete answers with the quota it leaves, and
      // the cache keeps the freshest of them.
      for (const link of links) {
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
      <Field label={single ? "Type the slug to confirm" : "Type delete to confirm"} error={error}>
        <Input
          ref={input}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(undefined);
          }}
          placeholder={expected}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
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
