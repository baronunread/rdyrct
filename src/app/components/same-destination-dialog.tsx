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
/** One match reads as a statement, several as a question. Both say the same
 * thing, so they live together rather than as ternaries down the dialog. */
const COPY = {
  one: {
    title: "This destination already has a link",
    body: "This destination already belongs to a link. Add this address to it so its settings and analytics stay together.",
  },
  many: {
    title: "This destination already has links",
    body: "This destination already belongs to these links. Add this address to one of them so its settings and analytics stay together.",
  },
};

/** With one match the dialog names it; with several the caller must pick, so
 * nothing is selected by default and "Add" stays disabled until they do. */
function MatchChoice({
  matchedLinks,
  selectedId,
  onSelect,
}: {
  matchedLinks: LinkDTO[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const only = matchedLinks.length <= 1 ? matchedLinks[0] : null;
  if (matchedLinks.length <= 1)
    return (
      <p className="truncate rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs">
        {only && shortUrl(only.slug, only.domain)}
      </p>
    );
  return (
    <Field label="Link">
      <MenuSelect
        label="Existing link"
        value={selectedId}
        onChange={onSelect}
        options={[
          { value: "", label: "Choose a link…" },
          ...matchedLinks.map((l) => ({ value: l.id, label: shortUrl(l.slug, l.domain) })),
        ]}
      />
    </Field>
  );
}

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

  useEffect(() => {
    setSelectedId(matchedLinks?.length === 1 ? matchedLinks[0].id : "");
  }, [matchedLinks]);

  // Stays mounted while closing so the Dialog can play its exit, which is why
  // this reads the count rather than returning null.
  const matches = matchedLinks ?? [];
  const copy = matches.length > 1 ? COPY.many : COPY.one;
  const selected = matches.find((l) => l.id === selectedId) ?? null;

  return (
    <Dialog
      open={matches.length > 0}
      onOpenChange={(o) => !o && onClose()}
      title={copy.title}
      // Can open while the link editor (dashboard's quick-create or the
      // Links page's New/Edit link dialog) is still open behind it.
      nested
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-1.5 text-sm">
          {copy.body}
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

        <MatchChoice matchedLinks={matches} selectedId={selectedId} onSelect={setSelectedId} />

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
