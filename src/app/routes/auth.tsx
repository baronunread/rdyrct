import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AuthCard, PasswordMeter } from "../components/auth-form";
import { authClient } from "../lib/auth-client";
import { friendlyAuthError, useShake } from "../lib/auth-form";
import { useCurrentUser } from "../lib/hooks";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { OtpInput } from "../ui/otp";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";

type View = "form" | "forgot" | "forgot-sent" | "verify-otp";

// Stricter than the browser's type="email" check (which lets "a@b" through)
// and matches what the server's schema accepts, so bad emails never reach it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

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
              <BusyContent busy={busy}>Send reset link</BusyContent>
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

/** OTP entry card shown after signup or an unverified login. */
function VerifyOtpView({
  email,
  otp,
  otpError,
  busy,
  resent,
  onOtpChange,
  onSubmit,
  onComplete,
  onResend,
  onBack,
}: {
  email: string;
  otp: string;
  otpError: string;
  busy: boolean;
  resent: boolean;
  onOtpChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onComplete: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <AuthCard>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">Enter your code</h1>
        <p className="text-sm text-muted">
          We emailed a 6-digit code to <span className="text-text">{email}</span>
          . It expires in 10 minutes.
        </p>
        <Field label="Verification code">
          <OtpInput
            value={otp}
            onChange={onOtpChange}
            onComplete={onComplete}
            disabled={busy}
            autoFocus
          />
        </Field>
        {otpError && <p className="text-sm text-danger">{otpError}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          <BusyContent busy={busy}>Verify & continue</BusyContent>
        </Button>
        <div className="flex items-center justify-between text-xs text-muted">
          {resent ? (
            <span>New code sent.</span>
          ) : (
            <button
              type="button"
              className="hover:text-accent"
              onClick={onResend}
            >
              Resend code
            </button>
          )}
          <Link to="/login" onClick={onBack}>
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

/** The main sign-in / sign-up card. */
function AuthFormView({
  mode,
  email,
  password,
  error,
  busy,
  shake,
  next,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onForgot,
}: {
  mode: "login" | "signup";
  email: string;
  password: string;
  error: string;
  busy: boolean;
  shake: ReturnType<typeof useShake>;
  next: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onForgot: () => void;
}) {
  return (
    <AuthCard>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">
          {mode === "login" ? "Sign in" : "Create an account"}
        </h1>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
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
                onClick={onForgot}
              >
                Forgot password?
              </button>
            ) : (
              <PasswordMeter password={password} />
            )
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          className={shake.className}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy}>{mode === "login" ? "Sign in" : "Sign up"}</BusyContent>
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
  const shake = useShake();

  // /login and /signup render this same mounted component, so switching modes
  // keeps all state: drop the previous mode's error instead of showing it
  // under the other form.
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setError("");
    shake.end();
  }

  const failSubmit = (message: string) => {
    setError(message);
    shake.start();
  };

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

  // Already signed in: skip the form. The form still paints while the session
  // check is in flight so signed-out visitors see no blank flash. This also
  // covers the post-verify path (the ["user"] refetch resolves and we leave).
  const { data: user } = useCurrentUser();
  useEffect(() => {
    if (!user) return;
    clearPending(); // a session means verified; drop any stale OTP state
    navigate(next, { replace: true });
  }, [user, navigate, next]);

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
    setError(""); // the pre-verify form error is stale by now
    setView("form");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // The form is noValidate: we run every check ourselves, in field order,
    // because the browser's checks are looser than the server's and its
    // bubbles can point at the wrong field.
    if (!EMAIL_RE.test(email)) {
      failSubmit("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      failSubmit("Password must be at least 8 characters.");
      return;
    }
    if (!password) {
      failSubmit("Enter your password.");
      return;
    }
    // Keep any previous error on screen while the retry is in flight: clearing
    // it here made the text vanish and reflash on every repeated failure.
    setBusy(true);
    try {
      if (mode === "login") {
        const { error: signInError } = await authClient.signIn.email({
          email,
          password,
        });
        if (signInError) {
          if (signInError.code === "EMAIL_NOT_VERIFIED") {
            await goVerify();
          } else {
            failSubmit(friendlyAuthError(signInError));
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
          failSubmit(friendlyAuthError(signUpError));
        } else {
          await goVerify();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async (code: string) => {
    if (busy) return; // onComplete + button click can both fire
    setOtpError("");
    setBusy(true);
    try {
      // verifyEmail signs the user in on success (sets the session cookie)
      const { error: verifyError } = await authClient.emailOtp.verifyEmail({
        email,
        otp: code.trim(),
      });
      if (verifyError) {
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
      clearPending();
      await qc.refetchQueries({ queryKey: ["user"] });
      navigate(next, { replace: true });
    } finally {
      setBusy(false);
    }
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
    try {
      const { error: resetError } = await authClient.requestPasswordReset({
        email: forgotEmail,
        redirectTo: "/reset-password",
      });
      if (resetError) {
        toast(resetError.message ?? "Something went wrong", "error");
        return;
      }
      setView("forgot-sent");
    } finally {
      setForgotBusy(false);
    }
  };

  if (view === "verify-otp") {
    return (
      <VerifyOtpView
        email={email}
        otp={otp}
        otpError={otpError}
        busy={busy}
        resent={resent}
        onOtpChange={setOtp}
        onSubmit={submitOtp}
        onComplete={runVerify}
        onResend={resendOtp}
        onBack={backToForm}
      />
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
    <AuthFormView
      mode={mode}
      email={email}
      password={password}
      error={error}
      busy={busy}
      shake={shake}
      next={next}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={submit}
      onForgot={() => {
        setForgotEmail(email);
        setView("forgot");
      }}
    />
  );
}
