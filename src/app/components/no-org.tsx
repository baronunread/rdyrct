import { useCallback } from "react";
import { errorMessage } from "@/app/lib/error-message";
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
import { ORG_LIMIT_MESSAGE } from "@/shared/support";

type OrgNameForm = { name: string };

function createErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "org_limit") return ORG_LIMIT_MESSAGE;
  return errorMessage(cause);
}

export function NoOrgState() {
  const { setOrg } = useCurrentOrg();
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const suggested = defaultOrgName(currentUser.data?.user.email ?? "", currentUser.data?.user.name);
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
        // Can still hold links made on the landing page before this org existed.
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
            Links, domains and teammates belong to an organization. Name it whatever you like.
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
