import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, PasswordMeter } from "../components/auth-form";
import { authClient } from "../lib/auth-client";
import { friendlyAuthError, useShake } from "../lib/auth-form";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shake = useShake();

  const failSubmit = (message: string) => {
    setError(message);
    shake.start();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // The form is noValidate: same manual, in-field-order checks as the
    // sign-up form. Keep any previous error on screen while a retry runs.
    if (password.length < 8) {
      failSubmit("Password must be at least 8 characters.");
      return;
    }
    if (confirm !== password) {
      failSubmit("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) {
        failSubmit(friendlyAuthError(resetError));
        return;
      }
      toast("Password updated, sign in with your new password");
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">Set a new password</h1>
        {!token && (
          <p className="text-sm text-danger">
            This reset link is missing its token. Request a new one from the
            sign-in page.
          </p>
        )}
        <Field label="New password" hint={<PasswordMeter password={password} />}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !token}
          className={shake.className}
          onAnimationEnd={shake.end}
        >
          {busy ? <Spinner /> : "Reset password"}
        </Button>
      </form>
    </AuthCard>
  );
}
