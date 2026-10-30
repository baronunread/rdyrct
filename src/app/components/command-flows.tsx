import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as v from "valibot";
import { LinkPreviewDialog } from "./link-preview-dialog";
import { SameDestinationDialog } from "./same-destination-dialog";
import { useLinkMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { useOrgLimits } from "../lib/org-limits";
import { useToast } from "../ui/toast";
import { api, ApiError } from "../lib/api";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
import type { InvitesCreated, LinkDTO, LinkInput } from "@/shared/types";

/* The two things ⌘K can do from what you type, rather than from a row:
 * make a link from a pasted URL, and invite a typed email address. */

type Match = { input: LinkInput; matchedLinks: LinkDTO[] };

/**
 * Creating a link from the palette follows the dashboard's quick-create flow
 * exactly: on success the QR-and-short-URL dialog opens; when the
 * destination already has a link the same "add this address to it" dialog
 * offers to alias it or make a separate link (#38). Returns `start(url)` and
 * the two dialogs to render.
 */
// fallow-ignore-next-line complexity
export function useLinkCreateFlow() {
  const { orgId, defaultDomainId, orgQr } = useOrgLimits();
  const toast = useToast();
  const { create } = useLinkMutations(orgId);
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  // The palette closes on click, so without this the first request runs with
  // nothing on screen. True only for the opening request; the merge/separate
  // resubmits show their spinner inside SameDestinationDialog.
  const [starting, setStarting] = useState(false);

  const submit = (input: LinkInput, extra: Partial<LinkInput>) =>
    create.mutate(
      { ...input, ...extra },
      {
        onSuccess: (link) => {
          setMatch(null);
          setCreated(link);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "same_destination_match") {
            // SAFETY: the route that sets same_destination_match attaches
            // matchedLinks alongside it, same shape the dashboard reads.
            const { matchedLinks } = e.data as { matchedLinks: LinkDTO[] };
            setMatch({ input, matchedLinks });
            return;
          }
          withErrorToast(toast)(e);
        },
        onSettled: () => setStarting(false),
      },
    );

  const start = (destination: string) => {
    const value = destination.trim();
    if (!v.safeParse(destinationSchema, { destination: value }).success) {
      toast("Enter a valid URL", "error");
      return;
    }
    setStarting(true);
    submit({ destination: value, domainId: defaultDomainId }, {});
  };

  const dialogs = (
    <>
      <LinkPreviewDialog
        title="Link created"
        link={created}
        loading={starting}
        orgQr={orgQr}
        onClose={() => {
          setCreated(null);
          setStarting(false);
        }}
      />
      <SameDestinationDialog
        matchedLinks={match?.matchedLinks ?? null}
        pending={create.isPending}
        onClose={() => setMatch(null)}
        onAddToExisting={(l) => match && submit(match.input, { mergeIntoLinkId: l.id })}
        onCreateSeparate={() => match && submit(match.input, { forceSeparateLink: true })}
      />
    </>
  );

  return { start, dialogs };
}

/**
 * Invite an email to the current org straight from the palette: the same
 * endpoint the members page posts to, role `member`. Roles, resending and
 * revoking stay on the members page; this is just the fast path.
 */
export function useInviteFlow(close: () => void): (email: string) => void {
  const { org } = useCurrentOrg();
  const toast = useToast();
  const qc = useQueryClient();
  const invite = useMutation({
    mutationFn: (email: string) =>
      api<InvitesCreated>(`/orgs/${org?.id ?? ""}/invites`, {
        method: "POST",
        body: { role: "member", emails: [email] },
      }),
    onSuccess: ({ failed }, email) => {
      void qc.invalidateQueries({ queryKey: ["invites", org?.id] });
      if (failed.length)
        toast(`Couldn't email ${email}`, "error", {
          detail: "The invite is saved. Send it again from Members.",
        });
      else toast(`Invite sent to ${email}`);
    },
    onError: withErrorToast(toast),
  });
  return (email) => {
    close();
    invite.mutate(email.trim());
  };
}
