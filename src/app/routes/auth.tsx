import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Me } from "@/shared/types";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const next =
    params.get("next") ??
    (location.state as { from?: string } | null)?.from ??
    "/app";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const me = await api<Me>(`/auth/${mode}`, {
        method: "POST",
        body:
          mode === "login"
            ? { email, password }
            : { email, password, name, orgName },
      });
      qc.setQueryData(["me"], me);
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xl font-bold tracking-widest">
          shrtnr<span className="text-accent">·</span>
        </p>
        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
        >
          <h1 className="font-bold">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h1>
          {mode === "signup" && (
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "8+ characters" : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>
          {mode === "signup" && (
            <Field label="Organization" hint="You can invite your team later">
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="acme inc"
              />
            </Field>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </Button>
          <p className="text-center text-xs text-muted">
            {mode === "login" ? (
              <>
                No account?{" "}
                <Link to={`/signup?next=${encodeURIComponent(next)}`}>Sign up</Link>
              </>
            ) : (
              <>
                Have an account?{" "}
                <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
