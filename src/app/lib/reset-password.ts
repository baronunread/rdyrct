import type { useNavigate } from "@tanstack/react-router";
import { authClient } from "./auth-client";
import { friendlyAuthError } from "./auth-errors";

export type ResetErrors = { password?: string; confirm?: string };

export function validateResetPassword(password: string, confirm: string): ResetErrors | null {
  if (!password) return { password: "Required" };
  if (password.length < 8) return { password: "At least 8 characters" };
  if (confirm !== password) return { confirm: "Does not match" };
  return null;
}

export async function submitResetPassword({
  password,
  confirm,
  token,
  toast,
  navigate,
  markFields,
  failSubmit,
  setBusy,
}: {
  password: string;
  confirm: string;
  token: string;
  toast: (message: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  markFields: (errors: ResetErrors) => void;
  failSubmit: (message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  const invalid = validateResetPassword(password, confirm);
  if (invalid) {
    markFields(invalid);
    return;
  }
  setBusy(true);
  try {
    const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
    if (resetError) {
      failSubmit(friendlyAuthError(resetError));
      return;
    }
    toast("Password updated, sign in with your new password");
    void navigate({ to: "/login", replace: true });
  } finally {
    setBusy(false);
  }
}
