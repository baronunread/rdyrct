/**
 * What a newly verified account sees before it has an organization (#65).
 *
 * It used to ask for an organization name, which is the activation cliff:
 * somebody who came to shorten a link, and who has just got through a landing
 * page, a signup form and a six-digit code, was asked to name a company before
 * anything happened.
 *
 * So it asks for the link instead, and makes the organization on the way past.
 * The name is derived from their email and stated plainly, because a name
 * chosen for you is only acceptable if you can see it and change it.
 *
 * The organization is still explicit in the data model: nothing here creates a
 * default org at signup, and /billing still works without one, so the landing
 * page's paid CTAs are unaffected.
 */
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { claimPendingLinks, storedAnonLinks } from "../lib/anon-links";
import { api } from "../lib/api";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser } from "../lib/hooks";
import { defaultOrgName } from "../lib/org-name";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { firstLinkSchema } from "../lib/schemas";
import type { LinkDTO } from "@/shared/types";

type FirstLinkForm = { destination: string };

export function NoOrgState() {
  const { setOrg } = useCurrentOrg();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FirstLinkForm>({
    resolver: valibotResolver(firstLinkSchema),
    defaultValues: { destination: "" },
  });

  const orgName = defaultOrgName(me.data?.user.email ?? "", me.data?.user.name);
  // Links made on the landing page before signing up (#96) are claimed by the
  // same act, so somebody arriving with three of them is told so.
  const waiting = storedAnonLinks().length;

  const submit = useCallback(
    async ({ destination }: FirstLinkForm) => {
      try {
        const org = await api<{ id: string }>("/orgs", {
          method: "POST",
          body: { name: orgName },
        });
        posthog.capture("organization_created");
        posthog.capture(FUNNEL.orgCreated, { from: "first_link" });

        // The organization exists either way: a rejected destination should
        // cost the person a retry on the link, not send them back to a screen
        // they have already cleared.
        setOrg(org.id);
        await claimPendingLinks(org.id);

        await api<LinkDTO>(`/orgs/${org.id}/links`, {
          method: "POST",
          body: { destination },
        });
        posthog.capture(FUNNEL.linkCreated, { from: "first_run" });

        await qc.refetchQueries({ queryKey: ["user"] });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Something went wrong", "error");
        // Whatever failed, the org may already exist, so let the app re-read
        // rather than stranding somebody on this screen with one made.
        await qc.refetchQueries({ queryKey: ["user"] });
      }
    },
    [orgName, setOrg, qc, toast],
  );

  return (
    <div className="grid place-items-center py-20">
      <form
        onSubmit={handleSubmit(submit, () => toast("Paste a link to shorten", "error"))}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-surface p-6 smooth-shadow-ring-sm"
      >
        <div>
          <h1 className="font-bold">Shorten your first link</h1>
          <p className="mt-1 text-sm text-muted">
            {waiting > 0
              ? `We will keep the ${waiting === 1 ? "link" : `${waiting} links`} you made before signing up, too.`
              : "Paste any long URL. Your links, domains and teammates live in an organization, and we will make yours as you go."}
          </p>
        </div>
        <Field label="Destination">
          <Input
            {...register("destination")}
            placeholder="https://example.com/a-very-long-address"
            autoFocus
          />
        </Field>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          <BusyContent busy={isSubmitting}>Create my first link</BusyContent>
        </Button>
        <p className="text-xs text-muted">
          Your organization will be called <span className="text-text">{orgName}</span>. Rename it
          any time in <Link to="/settings">Settings</Link>.
        </p>
      </form>
    </div>
  );
}
