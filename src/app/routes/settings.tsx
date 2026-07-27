import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api } from "../lib/api";
import type { OrgRole, UserOrg } from "@/shared/types";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { copyToClipboard } from "../lib/clipboard";
import { QrDefaultsCard } from "../components/qr-defaults-card";
import { orgNameSchema } from "../lib/schemas";

type OrgNameForm = { name: string };

/** The org-name field: syncs its default value when the current org
 * changes, and saves via PATCH. */
function useOrgRenameForm(org: UserOrg | null) {
  const qc = useQueryClient();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<OrgNameForm>({
    resolver: zodResolver(orgNameSchema),
    defaultValues: { name: "" },
  });
  const resetOrgId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!org) {
      resetOrgId.current = undefined;
      return;
    }
    if (resetOrgId.current === org.id) return;
    resetOrgId.current = org.id;
    reset({ name: org.name });
  }, [org, reset]);

  const currentName = watch("name");

  const rename = handleSubmit(
    async (data) => {
      try {
        await api(`/orgs/${org?.id ?? ""}`, { method: "PATCH", body: { name: data.name } });
        await qc.invalidateQueries({ queryKey: ["user"] });
        toast("Organization renamed");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    (errors) => toast(errors.name?.message ?? "Enter an organization name", "error"),
  );

  return { register, rename, currentName, isSubmitting, clearName: () => reset({ name: "" }) };
}

/** The delete-organization confirm dialog and its request. */
function useDeleteOrgFlow(orgId: string, clearNameField: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirmName("");
  };

  const deleteOrg = async () => {
    setPending(true);
    try {
      await api(`/orgs/${orgId}`, { method: "DELETE" });
      close();
      clearNameField();
      toast("Organization deleted");
      // useCurrentOrg falls back to the next org (or NoOrgState everywhere).
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(false);
    }
  };

  return { open, setOpen, close, confirmName, setConfirmName, pending, deleteOrg };
}

/** The delete-account confirm dialog and its request. */
function useDeleteAccountFlow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const deleteAccount = async () => {
    setPending(true);
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
      setPending(false);
    }
  };

  return { open, setOpen, pending, deleteAccount };
}

function OrgNameCard({
  orgId,
  isOwner,
  register,
  rename,
  currentName,
  isSubmitting,
}: {
  orgId: string;
  isOwner: boolean;
  register: ReturnType<typeof useOrgRenameForm>["register"];
  rename: () => void;
  currentName: string | undefined;
  isSubmitting: boolean;
}) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <Field label="Organization name">
          <Input {...register("name")} disabled={!isOwner} />
        </Field>
        <Field label="Organization id">
          <Input value={orgId} disabled readOnly />
        </Field>
        {isOwner ? (
          <div>
            <Button
              variant="primary"
              onClick={rename}
              disabled={!currentName?.trim() || isSubmitting}
            >
              <BusyContent busy={isSubmitting}>Save</BusyContent>
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Only the owner can change these settings.</p>
        )}
      </div>
    </Card>
  );
}

function DangerZoneCard({
  org,
  isOwner,
  onDeleteOrg,
  onDeleteAccount,
}: {
  org: UserOrg | null;
  isOwner: boolean;
  onDeleteOrg: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-2xs tracking-wider text-danger uppercase">Danger zone</p>
        {org && isOwner && (
          <>
            <p className="text-sm text-muted">
              Permanently delete <span className="text-text">{org.name}</span> with every link,
              custom domain, and all click history. Short links stop working immediately.
            </p>
            <div>
              <Button variant="danger" onClick={onDeleteOrg}>
                Delete organization
              </Button>
            </div>
            <div className="my-1 border-t border-border" />
          </>
        )}
        <p className="text-sm text-muted">
          Permanently delete your account. This does not delete organizations you belong to as a
          member, but you must delete any organizations you own first.
        </p>
        <div>
          <Button variant="danger" onClick={onDeleteAccount}>
            Delete account
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DeleteOrgDialog({
  org,
  flow,
}: {
  org: UserOrg;
  flow: ReturnType<typeof useDeleteOrgFlow>;
}) {
  const toast = useToast();
  return (
    <ConfirmDialog
      title="Delete organization"
      open={flow.open}
      onClose={flow.close}
      onConfirm={flow.deleteOrg}
      confirmLabel="Delete organization"
      danger
      pending={flow.pending}
      confirmDisabled={flow.confirmName.trim() !== org.name}
    >
      <div>
        <p className="mb-4 text-sm">
          This permanently deletes <span className="font-bold text-accent">{org.name}</span>: every
          link, custom domain, and all click history. Short links stop working immediately. This
          cannot be undone.
        </p>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <span>To confirm, type</span>
            <code className="rounded bg-bg px-1.5 py-0.5 text-text">{org.name}</code>
            <CopyButton
              text={org.name}
              label="Copy organization name"
              onCopy={(text) => copyToClipboard(text, toast)}
            />
          </div>
          <Input
            value={flow.confirmName}
            onChange={(e) => flow.setConfirmName(e.target.value)}
            placeholder={org.name}
            aria-label={`Type ${org.name} to confirm deletion`}
            autoFocus
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}

function isOrgOwner(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner";
}

function OrgSettingsCards({
  org,
  orgId,
  isOwner,
  register,
  rename,
  currentName,
  isSubmitting,
}: {
  org: UserOrg | null;
  orgId: string;
  isOwner: boolean;
  register: ReturnType<typeof useOrgRenameForm>["register"];
  rename: () => void;
  currentName: string | undefined;
  isSubmitting: boolean;
}) {
  if (!org) return null;
  return (
    <>
      <OrgNameCard
        orgId={orgId}
        isOwner={isOwner}
        register={register}
        rename={rename}
        currentName={currentName}
        isSubmitting={isSubmitting}
      />
      <QrDefaultsCard key={org.id} />
    </>
  );
}

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const isOwner = isOrgOwner(!!me.data?.user.isAdmin, org?.role);

  const { register, rename, currentName, isSubmitting, clearName } = useOrgRenameForm(org);
  const deleteOrgFlow = useDeleteOrgFlow(orgId, clearName);
  const deleteAccountFlow = useDeleteAccountFlow();

  return (
    <div>
      <PageHeader title="Settings" sub="Account and organization settings" />
      <div className="flex flex-col gap-4">
        {/* org cards only when an org exists; account deletion always */}
        <OrgSettingsCards
          org={org}
          orgId={orgId}
          isOwner={isOwner}
          register={register}
          rename={rename}
          currentName={currentName}
          isSubmitting={isSubmitting}
        />

        <DangerZoneCard
          org={org}
          isOwner={isOwner}
          onDeleteOrg={() => deleteOrgFlow.setOpen(true)}
          onDeleteAccount={() => deleteAccountFlow.setOpen(true)}
        />
      </div>

      {org && <DeleteOrgDialog org={org} flow={deleteOrgFlow} />}

      <ConfirmDialog
        title="Delete account"
        open={deleteAccountFlow.open}
        onClose={() => deleteAccountFlow.setOpen(false)}
        onConfirm={deleteAccountFlow.deleteAccount}
        confirmLabel="Delete account"
        danger
        pending={deleteAccountFlow.pending}
      >
        This permanently deletes your account. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
