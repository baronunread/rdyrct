import { useRef, useState, type FormEvent } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
import { Skeleton } from "../ui/skeleton";
import { BusyContent } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { useToast } from "../ui/toast";
import { useConfig } from "../lib/hooks";
import { relativeDate } from "../lib/dates";
import {
  connectGoogle,
  deviceName,
  useChangePassword,
  useDisconnectGoogle,
  useLinkedAccounts,
  useOtherSessions,
  useSignOutOtherSessions,
  type LinkedAccount,
  type SessionRow,
} from "../lib/account-security";

/**
 * How this account signs in, and where else it is signed in: the password,
 * Google, and every other browser. Each row says what is true now and
 * offers the one change that makes sense from there.
 */
export function SigningInGroup() {
  const accounts = useLinkedAccounts();
  const google = useConfig().data?.googleEnabled ?? false;
  const list = accounts.data ?? [];
  const hasPassword = list.some((a) => a.providerId === "credential");
  const googleAccount = list.find((a) => a.providerId === "google");
  return (
    <SettingsGroup title="Signing in">
      {accounts.isPending ? (
        <RowSkeleton label="Password" />
      ) : (
        <PasswordRow hasPassword={hasPassword} />
      )}
      {/* A Google account linked before Google was switched off on this
          instance still shows, so it can be disconnected. */}
      {(google || googleAccount) &&
        (accounts.isPending ? (
          <RowSkeleton label="Google" />
        ) : (
          <GoogleRow account={googleAccount} onlyWayIn={!hasPassword} canConnect={google} />
        ))}
      <OtherDevicesRow />
    </SettingsGroup>
  );
}

/** A row whose control is still loading, the height it will be. */
function RowSkeleton({ label }: { label: string }) {
  return (
    <SettingsRow label={label}>
      <Skeleton className="h-8 w-36" />
    </SettingsRow>
  );
}

function PasswordRow({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  if (!hasPassword)
    return (
      <SettingsRow label="Password" hint="None set. You sign in with Google.">
        <span className="text-sm text-muted">Not set</span>
      </SettingsRow>
    );
  return (
    <SettingsRow label="Password">
      <Button size="sm" onClick={() => setOpen(true)}>
        Change password
      </Button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </SettingsRow>
  );
}

function GoogleRow({
  account,
  onlyWayIn,
  canConnect,
}: {
  account: LinkedAccount | undefined;
  /** Google is the only way into this account, so it cannot go. */
  onlyWayIn: boolean;
  canConnect: boolean;
}) {
  const toast = useToast();
  const disconnect = useDisconnectGoogle();
  const [connecting, setConnecting] = useState(false);
  if (!account)
    return (
      <SettingsRow label="Google" hint="Sign in with your Google account as well.">
        {canConnect && (
          <Button
            size="sm"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true);
              try {
                await connectGoogle();
              } catch (e) {
                setConnecting(false);
                toast(errorMessage(e), "error");
              }
            }}
          >
            <BusyContent busy={connecting}>Connect</BusyContent>
          </Button>
        )}
      </SettingsRow>
    );
  return (
    <SettingsRow
      label="Google"
      hint={onlyWayIn ? "Your only way in, so it stays until you set a password." : undefined}
    >
      <span className="text-sm text-muted">Connected</span>
      {!onlyWayIn && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disconnect.isPending}
          onClick={() =>
            disconnect.mutate(account.id, {
              onSuccess: () => toast("Google disconnected"),
              onError: (e) => toast(errorMessage(e), "error"),
            })
          }
        >
          <BusyContent busy={disconnect.isPending}>Disconnect</BusyContent>
        </Button>
      )}
    </SettingsRow>
  );
}

/** "Safari on iPhone, 2 days ago", and how many more there are. */
function sessionsHint(sessions: SessionRow[]): string {
  if (sessions.length === 0) return "None. Only this browser is signed in.";
  const [newest] = sessions;
  const line = `${deviceName(newest.userAgent)}, ${relativeDate(newest.updatedAt)}`;
  return sessions.length === 1 ? line : `${line}, and ${sessions.length - 1} more`;
}

function OtherDevicesRow() {
  const toast = useToast();
  const sessions = useOtherSessions();
  const signOut = useSignOutOtherSessions();
  const list = sessions.data ?? [];
  return (
    <SettingsRow
      label="Other devices"
      hint={
        sessions.isPending ? (
          <span
            aria-hidden
            className="inline-block h-3 w-40 animate-pulse rounded-md bg-surface-2"
          />
        ) : (
          sessionsHint(list)
        )
      }
    >
      {list.length > 0 && (
        <Button
          size="sm"
          disabled={signOut.isPending}
          onClick={() =>
            signOut.mutate(undefined, {
              onSuccess: () =>
                toast(list.length === 1 ? "Signed out the other device" : "Signed out the others"),
              onError: (e) => toast(errorMessage(e), "error"),
            })
          }
        >
          <BusyContent busy={signOut.isPending}>Sign out</BusyContent>
        </Button>
      )}
    </SettingsRow>
  );
}

type PasswordErrors = { current?: string; next?: string };

/** Old password, new password, and whether every other browser goes too.
 * A wrong current password marks that field; anything else is a toast. */
function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const change = useChangePassword();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<PasswordErrors>({});

  const close = (value: boolean) => {
    onOpenChange(value);
    if (!value) {
      setCurrent("");
      setNext("");
      setErrors({});
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (change.isPending) return;
    const found: PasswordErrors = {
      current: current ? undefined : "Required",
      next: !next ? "Required" : next.length < 8 ? "At least 8 characters" : undefined,
    };
    setErrors(found);
    if (found.current) return currentRef.current?.focus();
    if (found.next) return nextRef.current?.focus();
    change.mutate(
      { currentPassword: current, newPassword: next, revokeOtherSessions: signOutOthers },
      {
        onSuccess: () => {
          toast("Password changed");
          close(false);
        },
        onError: (err) => {
          // BetterAuth says "Invalid password" for a wrong current one.
          if (/invalid password/i.test(err.message)) {
            setErrors({ current: "Not your current password" });
            currentRef.current?.focus();
            return;
          }
          toast(errorMessage(err), "error");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close} title="Change password" size="sm">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Current password" error={errors.current}>
          <Input
            ref={currentRef}
            type="password"
            autoComplete="current-password"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to fill this in.
            autoFocus
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setErrors((x) => ({ ...x, current: undefined }));
            }}
          />
        </Field>
        <Field label="New password" error={errors.next}>
          <Input
            ref={nextRef}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setErrors((x) => ({ ...x, next: undefined }));
            }}
          />
        </Field>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">Sign out other devices</span>
          <Switch
            label="Sign out other devices"
            checked={signOutOthers}
            onCheckedChange={setSignOutOthers}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            <BusyContent busy={change.isPending}>Change password</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
