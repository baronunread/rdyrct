import { useState, useEffect, useRef } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import type { User, UserOrg } from "@/shared/types";
import { AvatarInput } from "../components/avatar-input";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Switch } from "../ui/switch";
import { Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SettingsSkeleton } from "../components/skeletons";
import { accountNameSchema } from "../lib/schemas";
import { useTheme } from "../lib/theme";
import posthog from "../lib/posthog";

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

function AccountCard({ user }: { user: User | undefined }) {
  const { register, save, currentName, isSubmitting } = useAccountNameForm(user?.name);
  const [theme, toggleTheme] = useTheme();
  const nameUnchanged = !currentName?.trim() || currentName.trim() === (user?.name ?? "");
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col-reverse gap-5 sm:flex-row sm:items-start sm:gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Field label="Your name">
                <Input {...register("name")} />
              </Field>
              <Field label="Email">
                <Input value={user?.email ?? ""} disabled readOnly className="font-mono text-xs" />
              </Field>
            </div>
            {user && <AvatarInput user={user} />}
          </div>
          <div>
            <Button variant="primary" onClick={save} disabled={nameUnchanged || isSubmitting}>
              <BusyContent busy={isSubmitting}>Save</BusyContent>
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
          <div>
            <p className="text-sm">Dark mode</p>
            <p className="text-xs text-muted">Also on the account menu, bottom left.</p>
          </div>
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

function DeleteAccountCard({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-danger">Danger zone</p>
        <p className="text-sm text-muted">
          Permanently delete your account, and every organization you own with it. Organizations you
          only belong to are left alone.
        </p>
        <div>
          <Button variant="danger" onClick={onDelete} disabled={disabled}>
            Delete account
          </Button>
        </div>
      </div>
    </Card>
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
  const currentUser = useCurrentUser();
  const deleteAccountFlow = useDeleteAccountFlow();
  const ownedOrgs = (currentUser.data?.orgs ?? []).filter((o) => o.role === "owner");
  // The shell may paint Settings from its cache before this fresh /user
  // answer arrives. The cache is chrome, never permission to submit a
  // destructive action, and an empty fallback would hide the org names.
  const accountDeleteDisabled = currentUser.isLoading || !currentUser.data;

  if (currentUser.isLoading) return <SettingsSkeleton />;

  return (
    <div>
      <PageHeader title="Settings" sub="Your account" />
      <div className="flex flex-col gap-4">
        <AccountCard user={currentUser.data?.user} />
        <DeleteAccountCard
          disabled={accountDeleteDisabled}
          onDelete={() => deleteAccountFlow.setOpen(true)}
        />
      </div>

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
