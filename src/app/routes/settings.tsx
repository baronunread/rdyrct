import { useState, useEffect, useRef } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api } from "../lib/api";
import type { OrgRole, UserOrg } from "@/shared/types";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Switch } from "../ui/switch";
import { Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { copyToClipboard } from "../lib/clipboard";
import { QrDefaultsCard } from "../components/qr-defaults-card";
import { SettingsSkeleton } from "../components/skeletons";
import { accountNameSchema, orgNameSchema } from "../lib/schemas";
import { useTheme } from "../lib/theme";
import posthog from "../lib/posthog";

type OrgNameForm = { name: string };
type AccountNameForm = { name: string };

/** The account-name field: same PATCH-on-save shape as the org rename, but
 * it goes through BetterAuth's own updateUser endpoint. */
function useAccountNameForm(currentUserName: string | undefined) {
  const qc = useQueryClient();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<AccountNameForm>({
    resolver: valibotResolver(accountNameSchema),
    defaultValues: { name: "" },
  });
  const synced = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (currentUserName === undefined || synced.current === currentUserName) return;
    synced.current = currentUserName;
    reset({ name: currentUserName });
  }, [currentUserName, reset]);

  const currentName = watch("name");

  const save = handleSubmit(
    async (data) => {
      const { error } = await authClient.updateUser({ name: data.name.trim() });
      if (error) {
        toast(error.message ?? "Could not save your name", "error");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("account_name_changed");
      toast("Name saved");
    },
    (errors) => toast(errors.name?.message ?? "Enter your name", "error"),
  );

  return { register, save, currentName, isSubmitting };
}

function AccountCard({ userName }: { userName: string | undefined }) {
  const { register, save, currentName, isSubmitting } = useAccountNameForm(userName);
  const [theme, toggleTheme] = useTheme();
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <Field label="Your name">
          <Input {...register("name")} />
        </Field>
        <div>
          <Button
            variant="primary"
            onClick={save}
            disabled={
              !currentName?.trim() || currentName.trim() === (userName ?? "") || isSubmitting
            }
          >
            <BusyContent busy={isSubmitting}>Save</BusyContent>
          </Button>
        </div>
        <div className="border-t border-border" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm">Dark mode</p>
          <Switch
            label="Dark mode"
            checked={theme === "dark"}
            onCheckedChange={(on) => on !== (theme === "dark") && toggleTheme()}
          />
        </div>
      </div>
    </Card>
  );
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
      posthog.capture("account_deleted");
      window.location.assign("/");
    } catch (e) {
      toast(errorMessage(e), "error");
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
  accountDeleteDisabled,
  onDeleteOrg,
  onDeleteAccount,
}: {
  org: UserOrg | null;
  isOwner: boolean;
  accountDeleteDisabled: boolean;
  onDeleteOrg: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-danger">Danger zone</p>
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
          Permanently delete your account, and every organization you own with it. Organizations you
          only belong to are left alone.
        </p>
        <div>
          <Button variant="danger" onClick={onDeleteAccount} disabled={accountDeleteDisabled}>
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

/**
 * What deleting the account takes with it, named.
 *
 * An organization has no plan of its own: `orgPlan` reads its owner's. One
 * kept alive without an owner would have no plan, no billing and nobody who
 * could delete it, so the account cannot go without them. That is a large
 * thing to do quietly, so every organization is listed before the question is
 * asked (#119).
 */
function DeleteAccountWarning({ orgs }: { orgs: UserOrg[] }) {
  if (orgs.length === 0)
    return <p className="text-sm">This permanently deletes your account. This cannot be undone.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        This permanently deletes your account and the{" "}
        {orgs.length === 1 ? "organization" : `${orgs.length} organizations`} you own:
      </p>
      <ul className="flex flex-col gap-1 rounded-xl border border-border bg-surface-2 px-4 py-3">
        {orgs.map((org) => (
          <li key={org.id} className="text-sm font-semibold text-text">
            {org.name}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Every link, custom domain and all click history goes with them, for everyone in them. Short
        links stop working immediately. None of it can be recovered.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isOwner = isOrgOwner(!!currentUser.data?.user.isAdmin, org?.role);

  const { register, rename, currentName, isSubmitting, clearName } = useOrgRenameForm(org);
  const deleteOrgFlow = useDeleteOrgFlow(orgId, clearName);
  const deleteAccountFlow = useDeleteAccountFlow();
  const ownedOrgs = (currentUser.data?.orgs ?? []).filter((o) => o.role === "owner");
  // The shell may paint Settings from its cache before this fresh /user
  // answer arrives. The cache is chrome, never permission to submit a
  // destructive action, and an empty fallback would hide the org names.
  const accountDeleteDisabled = currentUser.isLoading || !currentUser.data;

  // Organization ownership and platform-admin status are authoritative only
  // after the fresh user response. The cache may be one page load behind.
  if (currentUser.isLoading) return <SettingsSkeleton />;

  return (
    <div>
      <PageHeader title="Settings" sub="Account and organization settings" />
      <div className="flex flex-col gap-4">
        <AccountCard userName={currentUser.data?.user.name} />

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
          accountDeleteDisabled={accountDeleteDisabled}
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
        confirmDisabled={accountDeleteDisabled}
      >
        <DeleteAccountWarning orgs={ownedOrgs} />
      </ConfirmDialog>
    </div>
  );
}
