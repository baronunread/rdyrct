import { useEffect, useState } from "react";
import { Info } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import type { LinkDTO } from "@/shared/types";

/** Offers to add the new address to a matching link instead of forking a duplicate (#38). */
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
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs wrap-break-word">
        {only?.url}
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
          ...matchedLinks.map((l) => ({ value: l.id, label: l.url })),
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

  // Stays mounted while closing so the Dialog can play its exit.
  const matches = matchedLinks ?? [];
  const copy = matches.length > 1 ? COPY.many : COPY.one;
  const selected = matches.find((l) => l.id === selectedId) ?? null;

  return (
    <Dialog
      open={matches.length > 0}
      onOpenChange={(o) => !o && onClose()}
      title={copy.title}
      nested
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-1.5 text-sm">
          {copy.body}
          <Tooltip content="Adding UTM parameters instead tracks each link on its own. A plain alias shares its clicks with the link you add it to.">
            <button
              type="button"
              aria-label="Alias vs. UTM parameters"
              className="relative mt-0.5 shrink-0 cursor-help text-muted after:absolute after:-inset-1.5 hover:text-text"
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
