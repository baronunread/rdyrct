import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { Card, PageHeader } from "../ui/misc";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { QrDefaultsCard } from "../components/qr-defaults-card";

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = me.data?.user.isAdmin || org?.role === "owner";
  // Draft-until-edited: tracks the active org (including one just created
  // from the NoOrgState below, while this page stays mounted) until typed in.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? org?.name ?? "";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOrgOpen, setDeleteOrgOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const rename = async () => {
    try {
      await api(`/orgs/${orgId}`, { method: "PATCH", body: { name } });
      await qc.invalidateQueries({ queryKey: ["user"] });
      toast("Organization renamed");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const copyOrgName = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  const deleteOrg = async () => {
    setDeletingOrg(true);
    try {
      await api(`/orgs/${orgId}`, { method: "DELETE" });
      setDeleteOrgOpen(false);
      setConfirmName("");
      setNameDraft(null);
      toast("Organization deleted");
      // useCurrentOrg falls back to the next org (or NoOrgState everywhere).
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeletingOrg(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await authClient.deleteUser({ callbackURL: "/" });
      if (error) {
        toast(error.message ?? "Failed to delete account", "error");
        return;
      }
      window.location.assign("/");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        sub="Account and organization settings"
      />
      <div className="flex flex-col gap-4">
        {/* org cards only when an org exists; account deletion always */}
        {org && (
          <>
            <Card className="max-w-2xl">
              <div className="flex flex-col gap-4">
                <Field label="Organization name">
                  <Input
                    value={name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Organization id">
                  <Input value={orgId} disabled readOnly />
                </Field>
                {isOwner ? (
                  <div>
                    <Button
                      variant="primary"
                      onClick={rename}
                      disabled={!name.trim()}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Only the owner can change these settings.
                  </p>
                )}
              </div>
            </Card>

            <QrDefaultsCard />
          </>
        )}

        <Card className="max-w-2xl">
          <div className="flex flex-col gap-3">
            <p className="text-2xs tracking-wider text-danger uppercase">
              Danger zone
            </p>
            {org && isOwner && (
              <>
                <p className="text-sm text-muted">
                  Permanently delete{" "}
                  <span className="text-text">{org.name}</span> with every
                  link, custom domain, and all click history. Short links
                  stop working immediately.
                </p>
                <div>
                  <Button
                    variant="danger"
                    onClick={() => setDeleteOrgOpen(true)}
                  >
                    Delete organization
                  </Button>
                </div>
                <div className="my-1 border-t border-border" />
              </>
            )}
            <p className="text-sm text-muted">
              Permanently delete your account. This does not delete
              organizations you belong to as a member, but you must delete
              any organizations you own first.
            </p>
            <div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete account
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {org && (
        <Dialog
          open={deleteOrgOpen}
          onOpenChange={(o) => {
            setDeleteOrgOpen(o);
            if (!o) setConfirmName("");
          }}
          title="Delete organization"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              This permanently deletes{" "}
              <span className="font-bold text-accent">{org.name}</span>:
              every link, custom domain, and all click history. Short links
              stop working immediately. This cannot be undone.
            </p>
            {/* outside a Field: its uppercase label would hide the name's
                real casing, which the exact-match check depends on */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <span>To confirm, type</span>
                <code className="rounded bg-bg px-1.5 py-0.5 text-text">
                  {org.name}
                </code>
                <CopyButton
                  text={org.name}
                  label="Copy organization name"
                  onCopy={copyOrgName}
                />
              </div>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={org.name}
                aria-label={`Type ${org.name} to confirm deletion`}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOrgOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={confirmName.trim() !== org.name || deletingOrg}
                onClick={deleteOrg}
              >
                {deletingOrg ? <Spinner /> : "Delete organization"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete account"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            This permanently deletes your account. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={deleteAccount}
            >
              {deleting ? <Spinner /> : "Delete account"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}


