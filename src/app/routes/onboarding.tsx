import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMe } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, ApiError } from "../lib/api";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { OnboardingSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { PLAN_LIMITS } from "@/shared/types";

export function OnboardingPage() {
  const me = useMe();
  const { setOrg } = useCurrentOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  if (me.isLoading) {
    return <OnboardingSkeleton />;
  }

  if (me.data && me.data.orgs.length > 0) {
    return <Navigate to="/dashboard" replace />;
  }

  const maxInvites = me.data
    ? PLAN_LIMITS[me.data.user.plan].members - 1
    : 0;

  const updateEmail = (i: number, value: string) => {
    setEmails((es) => es.map((e, idx) => (idx === i ? value : e)));
  };

  const addEmailRow = () => {
    setEmails((es) => [...es, ""]);
  };

  const removeEmailRow = (i: number) => {
    setEmails((es) => es.filter((_, idx) => idx !== i));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/orgs", {
        method: "POST",
        body: { name: name.trim() },
      });

      const inviteEmails = emails.map((e) => e.trim()).filter(Boolean);
      if (inviteEmails.length > 0) {
        try {
          await api(`/orgs/${created.id}/invites`, {
            method: "POST",
            body: { emails: inviteEmails },
          });
        } catch {
          toast("Organization created, but invites couldn't be sent", "error");
        }
      }

      setOrg(created.id);
      await qc.refetchQueries({ queryKey: ["user"] });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "org_limit") {
        toast("Upgrade to Pro to create more organizations", "error");
      } else {
        toast(
          err instanceof Error ? err.message : "Something went wrong",
          "error",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-xl font-bold tracking-widest">
          rdyrct
        </p>
        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
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

          <div>
            <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
              Invite your team
            </span>
            <div className="flex flex-col gap-2">
              {emails.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={value}
                    onChange={(e) => updateEmail(i, e.target.value)}
                    placeholder="teammate@company.com"
                  />
                  {emails.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEmailRow(i)}
                      aria-label="Remove email"
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={addEmailRow}
            >
              Add another
            </Button>
            {me.data && (
              <p className="mt-2 text-xs text-muted">
                You can invite up to {maxInvites} teammates on your plan
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={busy || !name.trim()}
          >
            {busy ? "…" : "Create organization"}
          </Button>
        </form>
      </div>
    </div>
  );
}
