import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import posthog from "../lib/posthog";
import { ApiError } from "../lib/api";
import { useLinkMutations, useLinkQuotaUsage } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { useSearchParams } from "../lib/router-search";
import { useToast } from "../ui/toast";
import { Button } from "../ui/button";
import { Plus } from "@/app/ui/icons";
import { LinkEditor } from "./link-editor";
import { LinkPreviewDialog } from "./link-preview-dialog";
import { SameDestinationDialog } from "./same-destination-dialog";
import type { LinkDTO, LinkInput } from "@/shared/types";
import { isShortcut } from "../lib/shortcut";
import { Kbd } from "../ui/kbd";
import { linkFieldError } from "../lib/link-field-errors";

/**
 * "New link" is one dialog, opened from anywhere (rdyrct-design, "Creating is
 * a dialog"): the header button on the dashboard and the links page, the `C`
 * key, and ⌘K's "Create link" (which lands with `?new=1`). It used to live
 * twice, as a field parked on the dashboard and as the links page's own
 * editor, and each copy handled a duplicate destination its own way.
 */
const NewLinkContext = createContext<{ openNewLink: () => void; canCreate: boolean }>({
  openNewLink: () => {},
  canCreate: false,
});

/** What a saved link used, for PostHog: four "did they fill in any of
 * these" questions. */
export function linkFeatures(data: LinkInput) {
  const any = (...fields: (string | null | undefined)[]) => fields.some(Boolean);
  return {
    has_custom_domain: data.domainId !== null,
    has_custom_slug: Boolean(data.slug?.trim()),
    has_qr_customization: any(data.qrStyle, data.qrColor, data.qrCorner, data.qrLogo),
    has_utm_parameters: any(
      data.utmSource,
      data.utmMedium,
      data.utmCampaign,
      data.utmTerm,
      data.utmContent,
    ),
  };
}

export function useNewLink() {
  return useContext(NewLinkContext);
}

/** The header button, the same on every page that has one: the one primary
 * action, with its key shown. */
export function NewLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <Plus size={15} aria-hidden /> New link
      <Kbd tone="primary" className="ml-0.5 max-sm:hidden">
        C
      </Kbd>
    </Button>
  );
}

/** `C` opens the dialog, unless the key is for a field, carries a modifier,
 * another dialog is already on screen, or something took the key first (the
 * first-run field on the dashboard, which catches every keystroke). */
function useNewLinkShortcut(open: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e, "c") || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, enabled]);
}

/** ⌘K's "Create link" sends people to `?new=1`: open once, then drop the
 * flag so a reload does not reopen it. */
function useOpenFromUrl(open: () => void, ready: boolean) {
  const [params, setParams] = useSearchParams();
  const wanted = params.has("new");
  useEffect(() => {
    // On a fresh load the org arrives after the first render, and open()
    // does nothing until it has. Wait for it rather than spend the flag.
    if (!wanted || !ready) return;
    open();
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ready]);
}

export function NewLinkHost({ children }: { children: ReactNode }) {
  const { org, orgId, limits, canWrite, activeDomains, defaultDomainId, orgQr } = useOrgLimits();
  const quota = useLinkQuotaUsage(orgId);
  const { create } = useLinkMutations(orgId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  // The last failed save, for the editor to pin on its field.
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [created, setCreated] = useState<{ link: LinkDTO; merged: boolean } | null>(null);
  const [match, setMatch] = useState<{ input: LinkInput; matchedLinks: LinkDTO[] } | null>(null);

  const canCreate = !!org && canWrite;
  const atLimit = (quota.data?.count ?? 0) >= limits.links;
  const openNewLink = () => {
    if (!canCreate) return;
    if (atLimit) {
      toast("Link limit reached: delete a link or upgrade for more", "error");
      return;
    }
    setSaveError(null);
    setOpen(true);
  };
  useNewLinkShortcut(openNewLink, canCreate);
  useOpenFromUrl(openNewLink, canCreate);

  const finish = (link: LinkDTO, event: string, input: LinkInput) => {
    posthog.capture(event, linkFeatures(input));
    setMatch(null);
    setOpen(false);
    setCreated({ link, merged: event === "link_alias_created" });
  };

  const onSave = (input: LinkInput) =>
    create.mutate(input, {
      onSuccess: (link) => finish(link, "link_created", input),
      onError: (e) => {
        if (e instanceof ApiError && e.code === "same_destination_match") {
          // SAFETY: the route that sets this code attaches matchedLinks with it.
          const { matchedLinks } = e.data as { matchedLinks: LinkDTO[] };
          setMatch({ input, matchedLinks });
          return;
        }
        // A refusal about the destination or the slug marks that field
        // (rdyrct-design, form errors); only the rest is a toast.
        setSaveError(e);
        if (!linkFieldError(e)) toast(e.message, "error");
        setShakeKey((k) => k + 1);
      },
    });

  const resolve = (extra: { mergeIntoLinkId: string } | { forceSeparateLink: true }) => {
    if (!match) return;
    const merging = "mergeIntoLinkId" in extra;
    create.mutate(
      { ...match.input, ...extra },
      {
        onSuccess: (link) =>
          finish(link, merging ? "link_alias_created" : "link_created", match.input),
        onError: (e) => toast(e.message, "error"),
      },
    );
  };

  return (
    <NewLinkContext.Provider value={{ openNewLink, canCreate }}>
      {children}
      {canCreate && (
        <>
          <LinkEditor
            open={open}
            onOpenChange={setOpen}
            editingLink={null}
            busy={create.isPending}
            onSave={onSave}
            activeDomains={activeDomains}
            defaultDomainId={defaultDomainId}
            domainsAllowed={limits.domains > 0}
            qrCustomEnabled={limits.qrCustom}
            orgQr={orgQr}
            shakeKey={shakeKey}
            saveError={saveError}
          />
          <SameDestinationDialog
            matchedLinks={match?.matchedLinks ?? null}
            pending={create.isPending}
            onClose={() => setMatch(null)}
            onAddToExisting={(link) => resolve({ mergeIntoLinkId: link.id })}
            onCreateSeparate={() => resolve({ forceSeparateLink: true })}
          />
          <LinkPreviewDialog
            title={created?.merged ? "Address added" : "Link created"}
            link={created?.link ?? null}
            onClose={() => setCreated(null)}
            orgQr={orgQr}
          />
        </>
      )}
    </NewLinkContext.Provider>
  );
}
