import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message ?? "Something went wrong");
      return;
    }
    toast("Password updated, sign in with your new password");
    navigate("/login", { replace: true });
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xl font-bold tracking-widest">
          <Link to="/" className="hover:text-accent">
            rdyrct
          </Link>
        </p>
        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
        >
          <h1 className="font-bold">Set a new password</h1>
          {!token && (
            <p className="text-sm text-danger">
              This reset link is missing its token. Request a new one from the
              sign-in page.
            </p>
          )}
          <Field label="New password" hint="8+ characters">
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
          <Button type="submit" variant="primary" disabled={busy || !token}>
            {busy ? "…" : "Reset password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
