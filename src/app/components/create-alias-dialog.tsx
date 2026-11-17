import { useState } from "react";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { useAddressMutations } from "../lib/hooks";
import { withErrorToast } from "../lib/mutation-toast";
import posthog from "../lib/posthog";
import type { LinkDTO } from "@/shared/types";

function CreateAliasForm({
  orgId,
  link,
  onClose,
}: {
  orgId: string;
  link: LinkDTO;
  onClose: () => void;
}) {
  const toast = useToast();
  const { create } = useAddressMutations(orgId, link.id);
  const [slug, setSlug] = useState("");

  // An alias shares its link's domain (#38), so a shared-domain link gets a random slug.
  const slugLocked = !link.domainId;

  const onSubmit = () => {
    create.mutate(
      { slug: slug.trim() },
      {
        onSuccess: () => {
          posthog.capture("link_alias_created", { has_custom_slug: Boolean(slug.trim()) });
          toast("Alias added");
          onClose();
        },
        onError: withErrorToast(toast),
      },
    );
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Add another address on{" "}
          <span className="font-mono text-text">{new URL(link.url).host}</span> that redirects to
          the same destination as <span className="font-mono text-text">/{link.slug}</span>.
        </p>

        <Field
          label="Slug"
          hint={
            slugLocked
              ? "Links on the shared domain get a random slug."
              : "Leave empty for a random one"
          }
        >
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={slugLocked ? "random" : "promo-2026"}
            disabled={slugLocked}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={create.isPending}>
          <BusyContent busy={create.isPending}>Create alias</BusyContent>
        </Button>
      </div>
    </>
  );
}

export function CreateAliasDialog({
  orgId,
  link,
  onClose,
}: {
  orgId: string;
  link: LinkDTO | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title="Create alias">
      {link && <CreateAliasForm key={link.id} orgId={orgId} link={link} onClose={onClose} />}
    </Dialog>
  );
}
