import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSearchParams } from "../lib/router-search";
import { PasswordMeter } from "../components/auth-form";
import { AuthHeading, AuthPanel } from "../components/auth-panel";
import { useShake } from "../lib/use-shake";
import { submitResetPassword, type ResetErrors } from "../lib/reset-password";
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
  const [errors, setErrors] = useState<ResetErrors>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const shake = useShake();

  const markFields = (next: ResetErrors) => {
    setErrors(next);
    (next.password ? passwordRef : confirmRef).current?.focus();
    shake.start();
  };

  const failSubmit = (message: string) => {
    toast(message, "error");
    shake.start();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void submitResetPassword({
      password,
      confirm,
      token,
      toast,
      navigate,
      markFields,
      failSubmit,
      setBusy,
    });
  };

  return (
    <AuthPanel>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <AuthHeading>Set a new password</AuthHeading>
        {!token && (
          <p className="text-sm text-danger">
            This reset link is missing its token. Request a new one from the sign-in page.
          </p>
        )}
        <Field
          label="New password"
          error={errors.password}
          hint={<PasswordMeter password={password} />}
        >
          <Input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors({});
            }}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <Input
            ref={confirmRef}
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrors((prev) => ({ password: prev.password }));
            }}
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
    </AuthPanel>
  );
}
