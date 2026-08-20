import type { useNavigate } from "@tanstack/react-router";
import { authClient } from "./auth-client";
import { friendlyAuthError } from "./auth-errors";

/** Same manual, in-field-order checks as the sign-up form. Returns the
 * first validation error, or null when the fields are ready to submit. */
export function validateResetPassword(password: string, confirm: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (confirm !== password) return "Passwords do not match.";
  return null;
}

export async function submitResetPassword({
  password,
  confirm,
  token,
  toast,
  navigate,
  failSubmit,
  setBusy,
}: {
  password: string;
  confirm: string;
  token: string;
  toast: (message: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  failSubmit: (message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  const validationError = validateResetPassword(password, confirm);
  if (validationError) {
    failSubmit(validationError);
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
    navigate({ to: "/login", replace: true });
  } finally {
    setBusy(false);
  }
}
