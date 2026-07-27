import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, PasswordMeter } from "../components/auth-form";
import { useShake } from "../lib/use-shake";
import { submitResetPassword } from "../lib/reset-password";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const shake = useShake();

  const failSubmit = (message: string) => {
    toast(message, "error");
    shake.start();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void submitResetPassword({ password, confirm, token, toast, navigate, failSubmit, setBusy });
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
            This reset link is missing its token. Request a new one from the sign-in page.
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
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !token}
          className={shake.className}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy}>Reset password</BusyContent>
        </Button>
      </form>
    </AuthCard>
  );
}
