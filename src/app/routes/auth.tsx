import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
  type NavigateFunction,
} from "react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AuthCard, PasswordMeter } from "../components/auth-form";
import { authClient } from "../lib/auth-client";
import { friendlyAuthError } from "../lib/auth-errors";
import { useShake } from "../lib/use-shake";
import { useCurrentUser } from "../lib/hooks";
import { firstFormError } from "../lib/form-errors";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { OtpInput } from "../ui/otp";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { loginSchema, signupSchema, forgotSchema, otpSchema } from "../lib/schemas";

type View = "form" | "forgot" | "forgot-sent" | "verify-otp";

type AuthForm = { email: string; password: string };
type ForgotForm = { email: string };
type OtpForm = { otp: string };

function ForgotView({
  initialEmail,
  sent,
  busy,
  onSubmit,
  onBack,
}: {
  initialEmail: string;
  sent: boolean;
  busy: boolean;
  onSubmit: (email: string) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const { register, handleSubmit, getValues } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: initialEmail },
  });

  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.email),
    (errors) => toast(firstFormError(errors, "Enter a valid email address"), "error"),
  );

  return (
    <AuthCard>
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
        <h1 className="font-bold">Reset your password</h1>
        {sent ? (
          <p className="text-sm text-muted">
            If that account exists, we sent a reset link to{" "}
            <span className="text-text">{getValues("email")}</span>.
          </p>
        ) : (
          <form onSubmit={onFormSubmit} className="flex flex-col gap-4">
            <Field label="Email">
              <Input type="email" {...register("email")} required autoComplete="email" />
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

function VerifyOtpView({
  email,
  busy,
  resent,
  onSubmit,
  onComplete,
  onResend,
  onBack,
}: {
  email: string;
  busy: boolean;
  resent: boolean;
  onSubmit: (code: string) => void;
  onComplete: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const { control, handleSubmit } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { otp: "" },
  });

  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.otp),
    (errors) => toast(firstFormError(errors, "Enter a 6-digit code"), "error"),
  );

  return (
    <AuthCard>
      <form
        onSubmit={onFormSubmit}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">Enter your code</h1>
        <p className="text-sm text-muted">
          We emailed a 6-digit code to <span className="text-text">{email}</span>. It expires in 10
          minutes.
        </p>
        <Field label="Verification code">
          <Controller
            control={control}
            name="otp"
            render={({ field }) => (
              <OtpInput
                value={field.value}
                onChange={field.onChange}
                onComplete={(v) => {
                  field.onChange(v);
                  onComplete(v);
                }}
                disabled={busy}
                autoFocus
              />
            )}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          <BusyContent busy={busy}>Verify & continue</BusyContent>
        </Button>
        <div className="flex items-center justify-between text-xs text-muted">
          {resent ? (
            <span>New code sent.</span>
          ) : (
            <button type="button" className="hover:text-accent" onClick={onResend}>
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

const AUTH_MODE_COPY = {
  login: {
    schema: loginSchema,
    title: "Sign in",
    submitLabel: "Sign in",
    passwordAutoComplete: "current-password" as const,
    footerPrompt: "No account?",
    footerTo: "/signup",
    footerLabel: "Sign up",
  },
  signup: {
    schema: signupSchema,
    title: "Create an account",
    submitLabel: "Sign up",
    passwordAutoComplete: "new-password" as const,
    footerPrompt: "Have an account?",
    footerTo: "/login",
    footerLabel: "Sign in",
  },
};

function PasswordHint({
  mode,
  password,
  onForgot,
}: {
  mode: "login" | "signup";
  password: string;
  onForgot: () => void;
}) {
  if (mode === "login") {
    return (
      <button type="button" className="text-muted hover:text-accent" onClick={onForgot}>
        Forgot password?
      </button>
    );
  }
  return <PasswordMeter password={password} />;
}

function AuthFormView({
  mode,
  busy,
  shake,
  next,
  onSubmit,
  onForgot,
}: {
  mode: "login" | "signup";
  busy: boolean;
  shake: ReturnType<typeof useShake>;
  next: string;
  onSubmit: (email: string, password: string) => void;
  onForgot: (email: string) => void;
}) {
  const copy = AUTH_MODE_COPY[mode];
  const toast = useToast();
  const { register, handleSubmit, watch, getValues } = useForm<AuthForm>({
    resolver: zodResolver(copy.schema),
    defaultValues: { email: "", password: "" },
  });

  const password = watch("password");
  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.email, data.password),
    (errors) => {
      toast(firstFormError(errors, "Check your email and password"), "error");
      shake.start();
    },
  );

  return (
    <AuthCard>
      <form
        onSubmit={onFormSubmit}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6"
      >
        <h1 className="font-bold">{copy.title}</h1>
        <Field label="Email">
          <Input type="email" {...register("email")} required autoComplete="email" />
        </Field>
        <Field
          label="Password"
          hint={
            <PasswordHint
              mode={mode}
              password={password}
              onForgot={() => onForgot(getValues("email"))}
            />
          }
        >
          <Input
            type="password"
            {...register("password")}
            required
            autoComplete={copy.passwordAutoComplete}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          className={shake.className}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy}>{copy.submitLabel}</BusyContent>
        </Button>
        <p className="text-center text-xs text-muted">
          {copy.footerPrompt}{" "}
          <Link to={`${copy.footerTo}?next=${encodeURIComponent(next)}`}>{copy.footerLabel}</Link>
        </p>
      </form>
    </AuthCard>
  );
}

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

interface SubmitDeps {
  goVerify: (email: string) => Promise<void>;
  failSubmit: (message: string) => void;
  qc: QueryClient;
  navigate: NavigateFunction;
  next: string;
}

async function trySignIn(email: string, password: string, deps: SubmitDeps) {
  const { error: signInError } = await authClient.signIn.email({ email, password });
  if (!signInError) {
    await deps.qc.refetchQueries({ queryKey: ["user"] });
    deps.navigate(deps.next, { replace: true });
    return;
  }
  if (signInError.code === "EMAIL_NOT_VERIFIED") {
    await deps.goVerify(email);
  } else {
    deps.failSubmit(friendlyAuthError(signInError));
  }
}

async function trySignUp(
  email: string,
  password: string,
  deps: Pick<SubmitDeps, "goVerify" | "failSubmit">,
) {
  const { error: signUpError } = await authClient.signUp.email({
    email,
    password,
    name: email.split("@")[0],
  });
  if (signUpError) {
    deps.failSubmit(friendlyAuthError(signUpError));
  } else {
    await deps.goVerify(email);
  }
}

interface VerifyDeps {
  authEmail: string;
  authPassword: string;
  next: string;
  navigate: NavigateFunction;
  toast: ReturnType<typeof useToast>;
}

/** After OTP verification, better-auth may or may not have already created a
 * session. If not, sign in with the password cached during submit, or, if
 * there's none (e.g. a page reload lost it), send the user to log in by
 * hand. Returns false when it already handled navigation itself. */
async function establishSessionAfterVerify(deps: VerifyDeps): Promise<boolean> {
  const sess = await authClient.getSession();
  if (sess?.data) return true;
  if (!deps.authPassword) {
    clearPending();
    deps.toast("Email verified. Sign in to continue.");
    deps.navigate(`/login?next=${encodeURIComponent(deps.next)}`, { replace: true });
    return false;
  }
  const { error: signInError } = await authClient.signIn.email({
    email: deps.authEmail,
    password: deps.authPassword,
  });
  if (signInError) {
    deps.toast(friendlyAuthError(signInError), "error");
    return false;
  }
  return true;
}

/** Login/signup state machine: view transitions, the OTP/password-reset
 * flows, and the post-auth redirect. Everything AuthPage's views need. */
function useAuthFlow(mode: "login" | "signup") {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<View>(() => (readPending() ? "verify-otp" : "form"));
  const [authEmail, setAuthEmail] = useState(() => readPending()?.email ?? "");
  const authPasswordRef = useRef("");
  const [busy, setBusy] = useState(false);
  const shake = useShake();

  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    shake.end();
  }

  const failSubmit = (message: string) => {
    toast(message, "error");
    shake.start();
  };

  const [forgotBusy, setForgotBusy] = useState(false);

  const [resent, setResent] = useState(false);

  const rawNext =
    readPending()?.next ??
    params.get("next") ??
    (location.state as { from?: string } | null)?.from ??
    "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const { data: user } = useCurrentUser();
  useEffect(() => {
    if (!user) return;
    clearPending();
    navigate(next, { replace: true });
  }, [user, navigate, next]);

  const goVerify = async (email: string) => {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    if (error) {
      failSubmit(error.message ?? "Could not send the verification code");
      return;
    }
    setAuthEmail(email);
    writePending({ email, next });
    setView("verify-otp");
  };

  const backToForm = () => {
    clearPending();
    setView("form");
  };

  const submit = async (email: string, password: string) => {
    setAuthEmail(email);
    authPasswordRef.current = password;
    setBusy(true);
    try {
      const deps = { goVerify, failSubmit, qc, navigate, next };
      await (mode === "login"
        ? trySignIn(email, password, deps)
        : trySignUp(email, password, deps));
    } catch (error) {
      failSubmit(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async (code: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error: verifyError } = await authClient.emailOtp.verifyEmail({
        email: authEmail,
        otp: code.trim(),
      });
      if (verifyError) {
        toast(verifyError.message ?? "That code is invalid or expired", "error");
        return;
      }
      const established = await establishSessionAfterVerify({
        authEmail,
        authPassword: authPasswordRef.current,
        next,
        navigate,
        toast,
      });
      if (!established) return;
      clearPending();
      await qc.refetchQueries({ queryKey: ["user"] });
      navigate(next, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    setResent(false);
    const { error: resendError } = await authClient.emailOtp.sendVerificationOtp({
      email: authEmail,
      type: "email-verification",
    });
    if (resendError) {
      toast(resendError.message ?? "Could not resend the code", "error");
      return;
    }
    setResent(true);
  };

  const submitForgot = async (email: string) => {
    setForgotBusy(true);
    try {
      const { error: resetError } = await authClient.requestPasswordReset({
        email,
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

  return {
    view,
    setView,
    authEmail,
    setAuthEmail,
    busy,
    shake,
    forgotBusy,
    resent,
    next,
    submit,
    runVerify,
    resendOtp,
    submitForgot,
    backToForm,
  };
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const flow = useAuthFlow(mode);

  if (flow.view === "verify-otp") {
    return (
      <VerifyOtpView
        email={flow.authEmail}
        busy={flow.busy}
        resent={flow.resent}
        onSubmit={flow.runVerify}
        onComplete={flow.runVerify}
        onResend={flow.resendOtp}
        onBack={flow.backToForm}
      />
    );
  }

  if (flow.view === "forgot" || flow.view === "forgot-sent") {
    return (
      <ForgotView
        initialEmail={flow.authEmail}
        sent={flow.view === "forgot-sent"}
        busy={flow.forgotBusy}
        onSubmit={flow.submitForgot}
        onBack={() => flow.setView("form")}
      />
    );
  }

  return (
    <AuthFormView
      key={mode}
      mode={mode}
      busy={flow.busy}
      shake={flow.shake}
      next={flow.next}
      onSubmit={flow.submit}
      onForgot={(email) => {
        flow.setAuthEmail(email);
        flow.setView("forgot");
      }}
    />
  );
}
