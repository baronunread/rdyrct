import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { useAddressMutations } from "../lib/hooks";
import { withErrorToast } from "../lib/mutation-toast";
import type { DomainDTO, LinkDTO } from "@/shared/types";

/** Owns the form state, freshly initialized from `link` on every mount: keyed
 * by `link.id` in the parent so switching links remounts this instead of
 * needing an effect to resync state after the fact. */
function CreateAliasForm({
  orgId,
  link,
  onClose,
  activeDomains,
  domainsAllowed,
}: {
  orgId: string;
  link: LinkDTO;
  onClose: () => void;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
}) {
  const toast = useToast();
  const { create } = useAddressMutations(orgId, link.id);
  const [domainId, setDomainId] = useState<string | null>(link.domainId);
  const [slug, setSlug] = useState("");

  const slugLocked = !domainId;

  const onSubmit = () => {
    create.mutate(
      { slug: slug.trim(), domainId },
      {
        onSuccess: () => {
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
          Add another address that redirects to the same destination as{" "}
          <span className="font-mono text-text">/{link.slug}</span>.
        </p>

        {activeDomains.length > 0 && (
          <Field label="Domain">
            <MenuSelect
              label="Domain"
              value={domainId ?? ""}
              onChange={(v) => {
                setDomainId(v || null);
                if (!v) setSlug("");
              }}
              options={[
                { value: "", label: `shared: ${window.location.host}` },
                ...activeDomains.map((d) => ({ value: d.id, label: d.hostname })),
              ]}
            />
          </Field>
        )}

        <Field
          label="Slug"
          hint={
            slugLocked ? (
              activeDomains.length > 0 ? (
                "Use a custom domain for a custom slug."
              ) : domainsAllowed ? (
                <>
                  <RouterLink to="/domains" className="text-accent hover:underline">
                    Connect a domain
                  </RouterLink>{" "}
                  for a custom slug.
                </>
              ) : (
                <>
                  <RouterLink to="/billing" className="text-accent hover:underline">
                    Upgrade
                  </RouterLink>{" "}
                  for a custom slug.
                </>
              )
            ) : (
              "Leave empty for a random one"
            )
          }
        >
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={slugLocked ? "random" : "promo-2026"}
            disabled={slugLocked}
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

/** Adds another address that redirects to the same link, from the links
 * table's kebab menu (#38): a slug on a custom domain, or a random one on
 * the shared domain, following the same rule as a new link's slug field. */
export function CreateAliasDialog({
  orgId,
  link,
  onClose,
  activeDomains,
  domainsAllowed,
}: {
  orgId: string;
  link: LinkDTO | null;
  onClose: () => void;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
}) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title="Create alias">
      {link && (
        <CreateAliasForm
          key={link.id}
          orgId={orgId}
          link={link}
          onClose={onClose}
          activeDomains={activeDomains}
          domainsAllowed={domainsAllowed}
        />
      )}
    </Dialog>
  );
}
