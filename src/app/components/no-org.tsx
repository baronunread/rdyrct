import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { useToast } from "../ui/toast";

/**
 * The app's onboarding: org-scoped pages render this when the user has no
 * organization yet. Creating one re-renders the page in place with the org
 * active — no navigation, no separate onboarding route. Billing is per-user
 * and stays fully usable before this step (paid CTAs check out first).
 */
export function NoOrgState() {
  const { setOrg } = useCurrentOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/orgs", {
        method: "POST",
        body: { name: name.trim() },
      });
      setOrg(created.id);
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Something went wrong",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid place-items-center py-20">
      <form
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <div>
          <h1 className="font-bold">Create your organization</h1>
          <p className="mt-1 text-sm text-muted">
            This is where your links, domains, and teammates will live.
          </p>
        </div>
        <Field label="Organization name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="acme inc"
            required
            autoFocus
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !name.trim()}
        >
          {busy ? "…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}
