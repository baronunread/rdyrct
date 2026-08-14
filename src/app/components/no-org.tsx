/**
 * What somebody sees on an org-scoped page while they belong to no
 * organization.
 *
 * This is no longer the first-run screen. Every account owns an organization
 * from its first session (`ensureOrganization` in the Worker), so reaching
 * this means they deleted the last one they owned, or were removed from the
 * last one they were in. Whoever gets here knows what an organization is, so
 * it asks the plain question with a name field and says nothing about how
 * they arrived: they did it on purpose, and narrating it back is either
 * obvious or wrong.
 *
 * The name is prefilled from their email the same way the automatic one is,
 * so the fast path is one click.
 */
import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { claimPendingLinks } from "../lib/anon-links";
import { api, ApiError } from "../lib/api";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser } from "../lib/hooks";
import { defaultOrgName } from "@/shared/org-name";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { orgNameSchema } from "../lib/schemas";

type OrgNameForm = { name: string };

/** The org-limit refusal gets the upgrade line; everything else says what the
 * server said. */
function createErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "org_limit")
    return "Upgrade to Pro to create more organizations";
  return err instanceof Error ? err.message : "Something went wrong";
}

export function NoOrgState() {
  const { setOrg } = useCurrentOrg();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const suggested = defaultOrgName(me.data?.user.email ?? "", me.data?.user.name);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<OrgNameForm>({
    resolver: valibotResolver(orgNameSchema),
    values: { name: suggested },
  });

  const submit = useCallback(
    async ({ name }: OrgNameForm) => {
      try {
        const org = await api<{ id: string }>("/orgs", { method: "POST", body: { name } });
        posthog.capture("organization_created");
        posthog.capture(FUNNEL.orgCreated, { from: "no_org" });
        setOrg(org.id);
        // Somebody can still arrive here holding links made on the landing
        // page: they signed up, deleted the organization those went to, and
        // shortened more before making another.
        await claimPendingLinks(org.id);
        await qc.refetchQueries({ queryKey: ["user"] });
      } catch (err) {
        toast(createErrorMessage(err), "error");
      }
    },
    [setOrg, qc, toast],
  );

  return (
    <div className="grid place-items-center py-20">
      <form
        onSubmit={handleSubmit(submit)}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-surface p-6 smooth-shadow-ring-sm"
      >
        <div>
          <h1 className="font-bold">Create an organization</h1>
          <p className="mt-1 text-sm text-muted">
            Links, domains and teammates live in an organization. Name it whatever you like.
          </p>
        </div>
        <Field label="Name">
          <Input {...register("name")} autoFocus />
        </Field>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          <BusyContent busy={isSubmitting}>Create organization</BusyContent>
        </Button>
      </form>
    </div>
  );
}
