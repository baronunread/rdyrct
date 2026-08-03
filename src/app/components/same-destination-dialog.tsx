import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { shortUrl } from "../lib/api";
import type { LinkDTO } from "@/shared/types";

/**
 * Shown when creating a link whose destination (and UTM set) exactly matches
 * one or more already in the org (#38): offers to add the new address to one
 * of those links instead of silently forking a duplicate, or to create a
 * separate link anyway. With several matches, nothing is picked by default:
 * the caller must choose which one, so "Add" starts disabled.
 */
export function SameDestinationDialog({
  matchedLinks,
  onClose,
  onAddToExisting,
  onCreateSeparate,
  pending,
}: {
  matchedLinks: LinkDTO[] | null;
  onClose: () => void;
  onAddToExisting: (link: LinkDTO) => void;
  onCreateSeparate: () => void;
  pending: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const multiple = (matchedLinks?.length ?? 0) > 1;

  useEffect(() => {
    setSelectedId(matchedLinks?.length === 1 ? matchedLinks[0].id : "");
  }, [matchedLinks]);

  const open = !!matchedLinks?.length;
  const selected = matchedLinks?.find((l) => l.id === selectedId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={
        multiple ? "This destination already has links" : "This destination already has a link"
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-1.5 text-sm">
          {multiple
            ? "This destination already belongs to these links. Add this address to one of them so its settings and analytics stay together."
            : "This destination already belongs to a link. Add this address to it so its settings and analytics stay together."}
          <Tooltip content="Adding UTM parameters instead tracks each link on its own, with real numbers for that link. A plain alias just shares its clicks with the one you add it to: sometimes that's exactly what you want.">
            <button
              type="button"
              aria-label="Alias vs. UTM parameters"
              className="mt-0.5 shrink-0 cursor-help text-muted hover:text-text"
            >
              <Info size={13} />
            </button>
          </Tooltip>
        </p>

        {multiple ? (
          <Field label="Link">
            <MenuSelect
              label="Existing link"
              value={selectedId}
              onChange={setSelectedId}
              options={[
                { value: "", label: "Choose a link…" },
                ...matchedLinks!.map((l) => ({ value: l.id, label: shortUrl(l.slug, l.domain) })),
              ]}
            />
          </Field>
        ) : (
          matchedLinks?.[0] && (
            <p className="truncate rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">
              {shortUrl(matchedLinks[0].slug, matchedLinks[0].domain)}
            </p>
          )
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onCreateSeparate} disabled={pending}>
            Create separate link
          </Button>
          <Button
            variant="primary"
            disabled={pending || !selected}
            onClick={() => selected && onAddToExisting(selected)}
          >
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
