import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { orgNameSchema } from "../lib/schemas";

type OrgNameForm = { name: string };

export function NoOrgState() {
  const { setOrg } = useCurrentOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<OrgNameForm>({
    resolver: zodResolver(orgNameSchema),
    defaultValues: { name: "" },
  });

  const submit = useCallback(
    async ({ name }: OrgNameForm) => {
      try {
        const created = await api<{ id: string }>("/orgs", {
          method: "POST",
          body: { name: name.trim() },
        });
        setOrg(created.id);
        await qc.refetchQueries({ queryKey: ["user"] });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Something went wrong", "error");
      }
    },
    [setOrg, qc, toast],
  );

  return (
    <div className="grid place-items-center py-20">
      <form
        onSubmit={handleSubmit(submit, () => toast("Enter an organization name", "error"))}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <div>
          <h1 className="font-bold">Create your organization</h1>
          <p className="mt-1 text-sm text-muted">
            This is where your links, domains, and teammates will live.
          </p>
        </div>
        <Field label="Organization name">
          <Input {...register("name")} placeholder="acme inc" autoFocus />
        </Field>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          <BusyContent busy={isSubmitting}>Create organization</BusyContent>
        </Button>
      </form>
    </div>
  );
}
