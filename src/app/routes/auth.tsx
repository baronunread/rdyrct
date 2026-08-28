import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSearchParams, HrefLink } from "../lib/router-search";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import { AuthCard, PasswordMeter } from "../components/auth-form";
import { authClient } from "../lib/auth-client";
import { friendlyAuthError } from "../lib/auth-errors";
import posthog from "../lib/posthog";
import { FUNNEL } from "../lib/funnel";
import { useShake } from "../lib/use-shake";
import { useCap } from "../lib/cap";
import { useCurrentUser, useConfig } from "../lib/hooks";
import { storedAnonLinks } from "../lib/anon-links";
import { lastAuthMethod, setLastAuthMethod } from "../lib/last-auth";
import { firstFormError } from "../lib/form-errors";
import { cn } from "../ui/cn";
import { Button } from "../ui/button";
import { Badge } from "../ui/misc";
import { Field, Input } from "../ui/field";
import { OtpInput } from "../ui/otp";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { loginSchema, signupSchema, forgotSchema, otpSchema } from "../lib/schemas";
import type { CurrentUser } from "@/shared/types";

/** Admin routes 404 in-app for non-admins, so a stale `next` pointed at
 * `/admin` (e.g. someone bookmarked it while logged out) shouldn't strand a
 * regular user there right after they sign in. */
function sanitizeNext(next: string, isAdmin: boolean): string {
  return next.startsWith("/admin") && !isAdmin ? "/dashboard" : next;
}

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
    resolver: valibotResolver(forgotSchema),
    defaultValues: { email: initialEmail },
  });

  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.email),
    (errors) => toast(firstFormError(errors, "Enter a valid email address"), "error"),
  );

  return (
    <AuthCard>
      <div className="flex flex-col gap-4 rounded-xl bg-surface p-6 smooth-shadow-ring-sm">
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
  verifyPhase,
  shake,
  resent,
  onSubmit,
  onComplete,
  onResend,
  onBack,
}: {
  email: string;
  busy: boolean;
  verifyPhase: "idle" | "success" | "leaving";
  shake: ReturnType<typeof useShake>;
  resent: boolean;
  onSubmit: (code: string, onInvalid?: () => void) => Promise<boolean>;
  onComplete: (code: string, onInvalid?: () => void) => Promise<boolean>;
  onResend: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const { control, handleSubmit, resetField } = useForm<OtpForm>({
    resolver: valibotResolver(otpSchema),
    defaultValues: { otp: "" },
  });
  const clearOtp = () => resetField("otp");

  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.otp, clearOtp),
    (errors) => toast(firstFormError(errors, "Enter a 6-digit code"), "error"),
  );

  const verified = verifyPhase !== "idle";

  return (
    <AuthCard className={verifyPhase === "leaving" ? "auth-card-leaving" : undefined}>
      <form
        onSubmit={onFormSubmit}
        className="flex flex-col gap-4 rounded-xl bg-surface p-6 smooth-shadow-ring-sm"
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
                  onComplete(v, clearOtp);
                }}
                disabled={busy}
                autoFocus
              />
            )}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          className={cn(
            shake.className,
            // `disabled` keeps the button inert through the fade, but its
            // own opacity-50 was washing the checkmark's green out.
            verified && "!bg-accent-2 disabled:opacity-100 saturate-150",
          )}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy} icon={verified ? <Check className="h-4 w-4" /> : undefined}>
            Verify & continue
          </BusyContent>
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

/**
 * One line under "Create an account", saying what happens next.
 *
 * The card used to render identically whether somebody arrived cold, clicked
 * "Start Pro", or clicked "Keep this link" with a link waiting to be claimed:
 * every reassurance the landing page built was dropped at the door. It also
 * never mentioned the emailed code, which is the step people abandon.
 *
 * Nothing under "Sign in". Somebody who already has an account does not need
 * to be sold the plan.
 */
function SignupSubtitle({ next }: { next: string }) {
  const body = storedAnonLinks().length
    ? "Your link is waiting. Sign up and it becomes permanent, with the clicks it earns."
    : next.startsWith("/billing")
      ? "Create your account, then check out. No card needed to create the account."
      : "Free plan, no credit card. We'll email you a 6-digit code to confirm your address.";
  return <p className="-mt-2 text-xs text-muted">{body}</p>;
}

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

/** Inline Google "G" mark (no remote image, CSP-safe). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function AuthFormView({
  mode,
  busy,
  shake,
  next,
  onSubmit,
  onForgot,
  onFirstInput,
}: {
  mode: "login" | "signup";
  busy: boolean;
  shake: ReturnType<typeof useShake>;
  next: string;
  onSubmit: (email: string, password: string) => void;
  onForgot: (email: string) => void;
  /** Starts the Cap proof-of-work (#98). Idempotent, so a per-keystroke
   * handler is fine; it fires once and the work overlaps the typing. */
  onFirstInput: () => void;
}) {
  const copy = AUTH_MODE_COPY[mode];
  const toast = useToast();
  const config = useConfig();
  // Read once on mount: a returning visitor who last signed in with Google
  // gets that button flagged.
  const [googleLastUsed] = useState(() => lastAuthMethod() === "google");
  const { register, handleSubmit, watch, getValues } = useForm<AuthForm>({
    resolver: valibotResolver(copy.schema),
    defaultValues: { email: "", password: "" },
  });

  const startGoogle = () => {
    setLastAuthMethod("google");
    posthog.capture("user_google_signin_started");
    // Full-page redirect to Google; returns to /api/auth/callback/google, then
    // to `next`. Same flow on login and signup (account linking handles an
    // existing email/password account).
    void authClient.signIn.social({ provider: "google", callbackURL: next });
  };

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
        onInput={onFirstInput}
        noValidate
        className="flex flex-col gap-4 rounded-xl bg-surface p-6 smooth-shadow-ring-sm"
      >
        <h1 className="font-bold">{copy.title}</h1>
        {mode === "signup" && <SignupSubtitle next={next} />}
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
        {config.data?.googleEnabled && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={startGoogle}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <GoogleG />
              Continue with Google
              {googleLastUsed && (
                <Badge color="accent" className="ml-1">
                  Last used
                </Badge>
              )}
            </button>
          </>
        )}
        <p className="text-center text-xs text-muted">
          {copy.footerPrompt}{" "}
          <HrefLink href={`${copy.footerTo}?next=${encodeURIComponent(next)}`}>
            {copy.footerLabel}
          </HrefLink>
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
    // SAFETY: this key is written by writePending() a few lines below and
    // nowhere else. A value that is not JSON leaves through the catch; one
    // that is JSON but not a Pending shows an empty address on the code form,
    // which the next submit corrects.
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
  navigate: ReturnType<typeof useNavigate>;
  next: string;
  /** Runs a Cap-guarded request, re-solving once if the token is refused. */
  capGuarded: <T>(run: (headers: Record<string, string>) => Promise<T>) => Promise<T>;
}

async function trySignIn(email: string, password: string, deps: SubmitDeps) {
  const { error: signInError } = await authClient.signIn.email({ email, password });
  if (!signInError) {
    setLastAuthMethod("password");
    await deps.qc.refetchQueries({ queryKey: ["user"] });
    const isAdmin = deps.qc.getQueryData<CurrentUser | null>(["user"])?.user.isAdmin ?? false;
    posthog.capture("user_signed_in");
    deps.navigate({ href: sanitizeNext(deps.next, isAdmin), replace: true });
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
  deps: Pick<SubmitDeps, "goVerify" | "failSubmit" | "capGuarded">,
) {
  // Cap's proof-of-work token (#98). Solved while the visitor was typing,
  // spent here, and required by the Worker before an account exists. Through
  // the guard, so a token the server has forgotten is solved again rather
  // than shown to somebody as an error.
  const { error: signUpError } = await deps.capGuarded((headers) =>
    authClient.signUp.email({ email, password, name: email.split("@")[0] }, { headers }),
  );
  if (signUpError) {
    deps.failSubmit(friendlyAuthError(signUpError));
  } else {
    // Funnel step 4 (#64), at the boundary that actually means "an account
    // was accepted". Before goVerify, so a failure to send the code cannot
    // lose the signup that already happened.
    posthog.capture(FUNNEL.signupSubmitted);
    await deps.goVerify(email);
  }
}

interface VerifyDeps {
  authEmail: string;
  authPassword: string;
  next: string;
  navigate: ReturnType<typeof useNavigate>;
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
    deps.navigate({ href: `/login?next=${encodeURIComponent(deps.next)}`, replace: true });
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

/** The stretch after the code is accepted and a session exists: a beat on the
 * green checkmark so acceptance registers, then the card fades before the
 * page changes. Out here because none of it is state, it is a sequence, and
 * it was the bulk of what made runVerify hard to read. */
async function finishVerifiedSignIn(deps: {
  mode: "login" | "signup";
  next: string;
  qc: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setVerifyPhase: (phase: "idle" | "success" | "leaving") => void;
}) {
  deps.setVerifyPhase("success");
  await new Promise((resolve) => setTimeout(resolve, 900));
  clearPending();
  await deps.qc.refetchQueries({ queryKey: ["user"] });
  if (deps.mode === "signup") {
    posthog.capture("user_signed_up");
    // Funnel step 5b (#64). Only on signup: a sign-in that happens to
    // re-verify is not someone crossing this step for the first time.
    posthog.capture(FUNNEL.verificationCompleted);
  }
  const isAdmin = deps.qc.getQueryData<CurrentUser | null>(["user"])?.user.isAdmin ?? false;
  deps.setVerifyPhase("leaving");
  await new Promise((resolve) => setTimeout(resolve, 300));
  deps.navigate({ href: sanitizeNext(deps.next, isAdmin), replace: true });
}

/** The password-reset flow, which shares nothing with the rest of the page
 * but the view it switches to and the toast it complains through. */
function useForgotPassword(setView: (view: View) => void, toast: ReturnType<typeof useToast>) {
  const resetCap = useCap("password-reset");
  const [forgotBusy, setForgotBusy] = useState(false);

  const submitForgot = async (email: string) => {
    setForgotBusy(true);
    try {
      // Cheap to abuse and it sends mail, which is why #50 needed a
      // per-recipient cap. Cap prices the attempt instead (#98).
      const { error: resetError } = await resetCap.guarded((headers) =>
        authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }, { headers }),
      );
      if (resetError) {
        toast(resetError.message ?? "Something went wrong", "error");
        return;
      }
      posthog.capture("password_reset_requested");
      setView("forgot-sent");
    } finally {
      setForgotBusy(false);
    }
  };

  return { forgotBusy, submitForgot };
}

/** Landing on /login or /signup while already signed in. Only a fallback:
 * during the OTP success/leaving sequence runVerify owns the redirect, and
 * this would race ahead of it the moment the `user` query refetch resolves,
 * skipping the transition entirely. */
function useRedirectWhenSignedIn(deps: {
  verifyPhase: "idle" | "success" | "leaving";
  next: string;
}) {
  const { data: user } = useCurrentUser();
  // Taken here rather than passed in: useNavigate returns the same thing
  // wherever it is called, and an effect calling a navigate it was handed
  // reads as a child pushing data back up to its parent.
  const navigate = useNavigate();
  const { verifyPhase, next } = deps;
  useEffect(() => {
    if (!user || verifyPhase !== "idle") return;
    clearPending();
    navigate({ href: sanitizeNext(next, user.user.isAdmin), replace: true });
  }, [user, navigate, next, verifyPhase]);
}

/** Login/signup state machine: view transitions, the OTP/password-reset
 * flows, and the post-auth redirect. Everything AuthPage's views need. */
function useAuthFlow(mode: "login" | "signup") {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<View>(() => (readPending() ? "verify-otp" : "form"));
  const [authEmail, setAuthEmail] = useState(() => readPending()?.email ?? "");
  const authPasswordRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<"idle" | "success" | "leaving">("idle");
  const shake = useShake();
  // Two scopes, two tokens: one minted for signup must not be spendable on a
  // password reset, so Cap binds the scope into the signature. The reset one
  // lives in useForgotPassword, which is the only thing that spends it.
  const signupCap = useCap("signup");

  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    shake.end();
  }

  const failSubmit = (message: string) => {
    toast(message, "error");
    shake.start();
  };

  const [resent, setResent] = useState(false);

  // RequireAuth bounces a signed-out visitor to /login?next=<path>, so the
  // query string is the only source for where to send them back.
  const rawNext = readPending()?.next ?? params.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const { forgotBusy, submitForgot } = useForgotPassword(setView, toast);
  useRedirectWhenSignedIn({ verifyPhase, next });

  const goVerify = async (email: string) => {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    // No EMAIL_VERIFIED branch: the server answers an already-verified
    // address exactly as it answers a fresh one, so an anonymous caller
    // cannot tell them apart (#53). The account's owner is told by email.
    if (error) failSubmit(error.message ?? "Could not send the verification code");
    // Funnel step 5a (#64). Only when a code really went out. Step 4 does not
    // belong here: goVerify is also reached from trySignIn's
    // EMAIL_NOT_VERIFIED branch, so counting a signup here would count every
    // returning unverified user as a new one.
    else posthog.capture(FUNNEL.verificationSent, { resend: false });

    // The code screen either way, error or not. By the time we get here the
    // account exists, and a failed send is usually the email rate limit
    // (#50), which clears in a minute. Staying on the signup form told
    // somebody the opposite: it looks like the signup failed, so they submit
    // again, which spends another send and puts them back here. The code
    // screen is the honest place to be stranded, because it has the resend
    // button that gets them out.
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
      const deps = { goVerify, failSubmit, qc, navigate, next, capGuarded: signupCap.guarded };
      await (mode === "login"
        ? trySignIn(email, password, deps)
        : trySignUp(email, password, deps));
    } catch (error) {
      failSubmit(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async (code: string, onInvalid?: () => void) => {
    if (busy) return true;
    setBusy(true);
    try {
      const { error: verifyError } = await authClient.emailOtp.verifyEmail({
        email: authEmail,
        otp: code.trim(),
      });
      if (verifyError) {
        failSubmit(verifyError.message ?? "That code is invalid or expired");
        // Clear before `finally` flips `busy` back to false, so OtpInput's
        // re-enable effect focuses an already-empty field instead of the
        // last-filled digit.
        onInvalid?.();
        return false;
      }
      const established = await establishSessionAfterVerify({
        authEmail,
        authPassword: authPasswordRef.current,
        next,
        navigate,
        toast,
      });
      if (!established) return false;
      await finishVerifiedSignIn({ mode, next, qc, navigate, setVerifyPhase });
      return true;
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
    posthog.capture(FUNNEL.verificationSent, { resend: true });
    setResent(true);
  };

  return {
    view,
    setView,
    authEmail,
    setAuthEmail,
    busy,
    verifyPhase,
    shake,
    forgotBusy,
    resent,
    next,
    submit,
    runVerify,
    resendOtp,
    submitForgot,
    backToForm,
    /** Hung on the forms' first interaction so the proof-of-work runs while
     * the visitor types, instead of stalling the submit. Signup only: a
     * password reset is rare enough that a short wait on submit is fine, and
     * priming it would tax everyone who came to log in. */
    primeSignupCap: signupCap.prime,
  };
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const flow = useAuthFlow(mode);

  if (flow.view === "verify-otp") {
    return (
      <VerifyOtpView
        email={flow.authEmail}
        busy={flow.busy}
        verifyPhase={flow.verifyPhase}
        shake={flow.shake}
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
      onFirstInput={flow.primeSignupCap}
      onForgot={(email) => {
        flow.setAuthEmail(email);
        flow.setView("forgot");
      }}
    />
  );
}
