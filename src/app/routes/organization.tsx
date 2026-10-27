import { useState, useEffect, useRef } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api } from "../lib/api";
import type { OrgRole, UserOrg } from "@/shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { PageHeader } from "../ui/misc";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { copyToClipboard } from "../lib/clipboard";
import { QrDefaultsCard } from "../components/qr-defaults-card";
import { NoOrgState } from "../components/no-org";
import { OrganizationSkeleton } from "../components/skeletons";
import { orgNameSchema } from "../lib/schemas";
import posthog from "../lib/posthog";

type OrgNameForm = { name: string };

function isOrgOwner(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner";
}

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
    resolver: valibotResolver(orgNameSchema),
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
        posthog.capture("organization_renamed");
        toast("Organization renamed");
      } catch (e) {
        toast(errorMessage(e), "error");
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
      posthog.capture("organization_deleted");
      close();
      clearNameField();
      toast("Organization deleted");
      // useCurrentOrg falls back to the next org (or NoOrgState everywhere).
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPending(false);
    }
  };

  return { open, setOpen, close, confirmName, setConfirmName, pending, deleteOrg };
}

function OrgRows({
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
  const toast = useToast();
  return (
    <SettingsGroup>
      <SettingsRow label="Name" hint={isOwner ? undefined : "Only the owner can rename it."}>
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <Input
            {...register("name")}
            aria-label="Organization name"
            disabled={!isOwner}
            className="min-w-0 flex-1 sm:w-60 sm:flex-none"
          />
          {isOwner && (
            <Button type="submit" disabled={!currentName?.trim() || isSubmitting}>
              <BusyContent busy={isSubmitting}>Save</BusyContent>
            </Button>
          )}
        </form>
      </SettingsRow>
      <SettingsRow label="Organization ID" hint="For the API.">
        <span className="font-mono text-xs">{orgId}</span>
        <CopyButton
          text={orgId}
          label="Copy organization ID"
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function DeleteOrgGroup({ onDelete }: { onDelete: () => void }) {
  return (
    <SettingsGroup danger>
      <SettingsRow
        label="Delete organization"
        hint="Its links, domains and click history go with it, at once."
      >
        <Button variant="danger" onClick={onDelete}>
          Delete organization
        </Button>
      </SettingsRow>
    </SettingsGroup>
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

export function OrganizationPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isOwner = isOrgOwner(!!currentUser.data?.user.isAdmin, org?.role);

  const { register, rename, currentName, isSubmitting, clearName } = useOrgRenameForm(org);
  const deleteOrgFlow = useDeleteOrgFlow(orgId, clearName);

  // Ownership is authoritative only after the fresh user response.
  if (currentUser.isLoading) return <OrganizationSkeleton />;
  if (!org) return <NoOrgState />;

  return (
    <div>
      <PageHeader title="Organization" />
      <div className="flex max-w-[760px] flex-col gap-8">
        <OrgRows
          orgId={orgId}
          isOwner={isOwner}
          register={register}
          rename={rename}
          currentName={currentName}
          isSubmitting={isSubmitting}
        />
        <QrDefaultsCard key={org.id} />
        {isOwner && <DeleteOrgGroup onDelete={() => deleteOrgFlow.setOpen(true)} />}
      </div>

      <DeleteOrgDialog org={org} flow={deleteOrgFlow} />
    </div>
  );
}
