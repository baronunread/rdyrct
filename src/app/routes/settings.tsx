import { useState, useEffect, useRef } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import type { User, UserOrg } from "@/shared/types";
import { AvatarInput } from "../components/avatar-input";
import { uploadUserAvatar, deleteUserAvatar } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { Switch } from "../ui/switch";
import { PageHeader } from "../ui/misc";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SettingsSkeleton } from "../components/skeletons";
import { accountNameSchema } from "../lib/schemas";
import { useTheme } from "../lib/theme";
import posthog from "../lib/posthog";

type AccountNameForm = { name: string };

/** The picture staged in the form: a cropped blob to upload, or a removal.
 * Nothing reaches the server until Save. `url` is a data URL (the CSP's
 * img-src allows `data:` but not `blob:`) for the live preview. */
function usePendingPicture() {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [remove, setRemove] = useState(false);
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    let live = true;
    const reader = new FileReader();
    reader.onload = () => live && setUrl(String(reader.result));
    reader.readAsDataURL(blob);
    return () => {
      live = false;
    };
  }, [blob]);

  return {
    blob,
    remove,
    url,
    dirty: Boolean(blob) || remove,
    pick: (b: Blob) => {
      setRemove(false);
      setBlob(b);
    },
    clear: () => {
      setBlob(null);
      setRemove(true);
    },
    reset: () => {
      setBlob(null);
      setRemove(false);
    },
  };
}

type SaveOutcome = "name" | "picture-set" | "picture-clear";

/** Push whatever changed. Throws on failure with a message to toast. */
async function persistAccount(
  user: User | undefined,
  name: string,
  pic: { blob: Blob | null; remove: boolean },
): Promise<SaveOutcome> {
  if (name !== (user?.name ?? "")) {
    const { error } = await authClient.updateUser({ name });
    if (error) throw new Error(error.message ?? "Could not save your name");
  }
  if (pic.blob) {
    await uploadUserAvatar(pic.blob);
    return "picture-set";
  }
  if (pic.remove) {
    await deleteUserAvatar();
    return "picture-clear";
  }
  return "name";
}

const SAVE_TOAST = {
  name: "Name saved",
  "picture-set": "Picture updated",
  "picture-clear": "Picture removed",
} satisfies Record<SaveOutcome, string>;

/** The account form: the name field plus the staged picture, and one Save
 * that applies whichever of them changed. */
function useAccountForm(user: User | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<AccountNameForm>({
    resolver: valibotResolver(accountNameSchema),
    defaultValues: { name: "" },
  });
  const synced = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (user?.name === undefined || synced.current === user.name) return;
    synced.current = user.name;
    form.reset({ name: user.name });
  }, [user?.name, form]);

  const pic = usePendingPicture();
  const currentName = form.watch("name") ?? "";
  const nameChanged = currentName.trim().length > 0 && currentName.trim() !== (user?.name ?? "");

  const save = form.handleSubmit(
    async (data) => {
      try {
        const outcome = await persistAccount(user, data.name.trim(), pic);
        await qc.invalidateQueries({ queryKey: ["user"] });
        posthog.capture("account_updated");
        toast(SAVE_TOAST[outcome]);
        pic.reset();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    (errors) => toast(errors.name?.message ?? "Enter your name", "error"),
  );

  return {
    register: form.register,
    currentName,
    pic,
    save,
    isSubmitting: form.formState.isSubmitting,
    dirty: nameChanged || pic.dirty,
  };
}

function AccountGroup({ user }: { user: User | undefined }) {
  const [theme, toggleTheme] = useTheme();
  const { register, currentName, pic, save, isSubmitting, dirty } = useAccountForm(user);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3"
    >
      <SettingsGroup title="Account">
        <SettingsRow label="Picture" hint="Shown to your teammates.">
          {user && (
            <AvatarInput
              size={40}
              // Blobatar tracks the name being typed; the image wins over it.
              user={{ ...user, name: currentName.trim() || user.name }}
              pendingUrl={pic.url}
              pendingRemove={pic.remove}
              onPick={pic.pick}
              onRemove={pic.clear}
            />
          )}
        </SettingsRow>
        <SettingsRow label="Name">
          <Input {...register("name")} aria-label="Your name" className="w-60 max-sm:w-full" />
        </SettingsRow>
        <SettingsRow label="Email">
          <span className="font-mono text-xs">{user?.email}</span>
        </SettingsRow>
        <SettingsRow label="Dark mode" hint="Also on the account menu.">
          <Switch
            label="Dark mode"
            checked={theme === "dark"}
            onCheckedChange={(on) => on !== (theme === "dark") && toggleTheme()}
          />
        </SettingsRow>
      </SettingsGroup>
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={!dirty || isSubmitting}>
          <BusyContent busy={isSubmitting}>Save</BusyContent>
        </Button>
      </div>
    </form>
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

function DeleteAccountGroup({
  disabled,
  ownedCount,
  onDelete,
}: {
  disabled: boolean;
  ownedCount: number;
  onDelete: () => void;
}) {
  return (
    <SettingsGroup danger>
      <SettingsRow
        label="Delete account"
        hint={
          ownedCount > 0
            ? `Also deletes the ${ownedCount === 1 ? "organization" : `${ownedCount} organizations`} you own.`
            : "Organizations you only belong to are left alone."
        }
      >
        <Button variant="danger" onClick={onDelete} disabled={disabled}>
          Delete account
        </Button>
      </SettingsRow>
    </SettingsGroup>
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
      <ul className="flex flex-col gap-1 rounded-xl bg-surface-2 px-4 py-3">
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
      <PageHeader title="Settings" />
      <div className="flex max-w-[760px] flex-col gap-8">
        <AccountGroup user={currentUser.data?.user} />
        <DeleteAccountGroup
          disabled={accountDeleteDisabled}
          ownedCount={ownedOrgs.length}
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
