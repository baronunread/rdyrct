import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth-client";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { OtpInput } from "../ui/otp";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xl font-bold tracking-widest">
          <Link to="/" className="hover:text-accent">
            rdyrct
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

type View = "form" | "forgot" | "forgot-sent" | "verify-otp";

/** Password-reset request card ("email on its way" state included). */
function ForgotView({
  sent,
  email,
  busy,
  onEmailChange,
  onSubmit,
  onBack,
}: {
  sent: boolean;
  email: string;
  busy: boolean;
  onEmailChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <AuthCard>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
        <h1 className="font-bold">Reset your password</h1>
        {sent ? (
          <p className="text-sm text-muted">
            If that account exists, we sent a reset link to{" "}
            <span className="text-text">{email}</span>.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner /> : "Send reset link"}
            </Button>
          </form>
        )}
        <p className="text-center text-xs text-muted">
          <Link to="/login" onClick={onBack}>
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}

// The OTP screen survives a reload: the pending email (and post-verify
// destination) live in sessionStorage until the code is entered or the user
// backs out, so a refresh mid-verification doesn't dump you at the form.
const PENDING_KEY = "rdyrct:pendingVerify";
interface Pending {
  email: string;
  next: string;
}
function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(p: Pending) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  // Restore the OTP screen on reload (before first paint, so no form flash).
  const [view, setView] = useState<View>(() =>
    readPending() ? "verify-otp" : "form",
  );
  const [email, setEmail] = useState(() => readPending()?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [resent, setResent] = useState(false);

  const rawNext =
    readPending()?.next ??
    params.get("next") ??
    (location.state as { from?: string } | null)?.from ??
    "/dashboard";
  // Internal paths only: anything else (absolute URLs, protocol-relative)
  // would be an open redirect. Stale pre-refactor paths (/app/:orgId/*) are
  // fine — the router remaps them.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";

  // Move to the OTP screen and email a fresh code (the frontend is the single
  // sender; see better-auth.ts). Persist the pending state so a reload keeps
  // us here rather than bouncing back to the form.
  const goVerify = async () => {
    setOtp("");
    setOtpError("");
    setResent(false);
    writePending({ email, next });
    setView("verify-otp");
    await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
  };

  const backToForm = () => {
    clearPending();
    setView("form");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    if (mode === "login") {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });
      if (signInError) {
        if (signInError.code === "EMAIL_NOT_VERIFIED") {
          await goVerify();
        } else {
          setError(signInError.message ?? "Something went wrong");
        }
      } else {
        await qc.refetchQueries({ queryKey: ["user"] });
        navigate(next, { replace: true });
      }
    } else {
      const { error: signUpError } = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0],
      });
      if (signUpError) {
        setError(signUpError.message ?? "Something went wrong");
      } else {
        await goVerify();
      }
    }
    setBusy(false);
  };

  const runVerify = async (code: string) => {
    if (busy) return; // onComplete + button click can both fire
    setOtpError("");
    setBusy(true);
    // verifyEmail signs the user in on success (sets the session cookie)
    const { error: verifyError } = await authClient.emailOtp.verifyEmail({
      email,
      otp: code.trim(),
    });
    if (verifyError) {
      setBusy(false);
      setOtpError(verifyError.message ?? "That code is invalid or expired");
      return;
    }
    // verifyEmail sets the session cookie, but on the signup path (and the
    // unverified-login path) the client-side session atom can lag behind,
    // make sure a session actually exists before moving on so /dashboard
    // doesn't bounce the user back to login.
    const sess = await authClient.getSession();
    if (!sess?.data) {
      await authClient.signIn.email({ email, password });
    }
    setBusy(false);
    clearPending();
    await qc.refetchQueries({ queryKey: ["user"] });
    navigate(next, { replace: true });
  };

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    runVerify(otp);
  };

  const resendOtp = async () => {
    setResent(false);
    setOtpError("");
    const { error: resendError } = await authClient.emailOtp.sendVerificationOtp(
      { email, type: "email-verification" },
    );
    if (resendError) {
      toast(resendError.message ?? "Could not resend the code", "error");
      return;
    }
    setResent(true);
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    const { error: resetError } = await authClient.requestPasswordReset({
      email: forgotEmail,
      redirectTo: "/reset-password",
    });
    setForgotBusy(false);
    if (resetError) {
      toast(resetError.message ?? "Something went wrong", "error");
      return;
    }
    setView("forgot-sent");
  };

  if (view === "verify-otp") {
    return (
      <AuthCard>
        <form
          onSubmit={submitOtp}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
        >
          <h1 className="font-bold">Enter your code</h1>
          <p className="text-sm text-muted">
            We emailed a 6-digit code to{" "}
            <span className="text-text">{email}</span>. It expires in 10
            minutes.
          </p>
          <Field label="Verification code">
            <OtpInput
              value={otp}
              onChange={setOtp}
              onComplete={runVerify}
              disabled={busy}
              autoFocus
            />
          </Field>
          {otpError && <p className="text-sm text-danger">{otpError}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : "Verify & continue"}
          </Button>
          <div className="flex items-center justify-between text-xs text-muted">
            {resent ? (
              <span>New code sent.</span>
            ) : (
              <button
                type="button"
                className="hover:text-accent"
                onClick={resendOtp}
              >
                Resend code
              </button>
            )}
            <Link to="/login" onClick={backToForm}>
              Back to sign in
            </Link>
          </div>
        </form>
      </AuthCard>
    );
  }

  if (view === "forgot" || view === "forgot-sent") {
    return (
      <ForgotView
        sent={view === "forgot-sent"}
        email={forgotEmail}
        busy={forgotBusy}
        onEmailChange={setForgotEmail}
        onSubmit={submitForgot}
        onBack={() => setView("form")}
      />
    );
  }

  return (
    <AuthCard>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">
          {mode === "login" ? "Sign in" : "Create an account"}
        </h1>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>
        {/* Both modes always render exactly one hint line here, so the sign-in
            and sign-up cards stay the same height. */}
        <Field
          label="Password"
          hint={
            mode === "login" ? (
              <button
                type="button"
                className="text-muted hover:text-accent"
                onClick={() => {
                  setForgotEmail(email);
                  setView("forgot");
                }}
              >
                Forgot password?
              </button>
            ) : (
              "8+ characters"
            )
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Spinner /> : mode === "login" ? "Sign in" : "Sign up"}
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
    </AuthCard>
  );
}
