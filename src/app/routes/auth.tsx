import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useForm, Controller, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSearchParams, HrefLink } from "../lib/router-search";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "@/app/ui/icons";
import { PasswordMeter } from "../components/auth-form";
import { AUTH_LINK, AuthHeading, AuthPanel, InviteBanner } from "../components/auth-panel";
import { authClient } from "../lib/auth-client";
import { friendlyAuthError } from "../lib/auth-errors";
import posthog from "../lib/posthog";
import {
  FUNNEL,
  SIGNUP_FAILED,
  USER_SIGNED_UP,
  captureEmailSignup,
  googleSignupUrl,
} from "../lib/funnel";
import { useShake } from "../lib/use-shake";
import {
  type TurnstileChallenge,
  CHALLENGE_LABEL,
  guardedButton,
  useTurnstile,
} from "../lib/turnstile";
import { TurnstileSlot } from "../components/turnstile-slot";
import { useCurrentUser, useConfig } from "../lib/hooks";
import { storedAnonLinks } from "../lib/anon-links";
import { readAuthHint } from "../lib/user-cache";
import { lastAuth, setLastAuth } from "../lib/last-auth";
import { firstFormError } from "../lib/form-errors";
import { cn } from "../ui/cn";
import { Button } from "../ui/button";
import { Field, FieldReason, Input, InvalidMark } from "../ui/field";
import { invalidAria, type InvalidAria } from "../ui/invalid-aria";
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
  challenge,
  onSubmit,
  onBack,
}: {
  initialEmail: string;
  sent: boolean;
  busy: boolean;
  challenge: TurnstileChallenge;
  onSubmit: (email: string) => void;
  onBack: () => void;
}) {
  const button = guardedButton(busy, challenge);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: valibotResolver(forgotSchema),
    defaultValues: { email: initialEmail },
  });

  // A bad address marks the field (react-hook-form focuses it); nothing toasts.
  const onFormSubmit = handleSubmit((data) => onSubmit(data.email));

  return (
    <AuthPanel>
      <AuthHeading>Reset your password</AuthHeading>
      {sent ? (
        <p className="text-center text-sm text-pretty text-muted">
          If that account exists, we sent a reset link to{" "}
          <span className="font-mono text-text">{getValues("email")}</span>.
        </p>
      ) : (
        <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Email" error={errors.email?.message}>
            <Input
              type="email"
              {...register("email")}
              autoComplete="email"
              placeholder="you@company.com"
              className="h-10"
            />
          </Field>
          <TurnstileSlot challenge={challenge} />
          <Button type="submit" variant="primary" disabled={button.disabled} className="h-10">
            <BusyContent busy={button.spinning}>
              {button.waiting ? CHALLENGE_LABEL : "Send reset link"}
            </BusyContent>
          </Button>
        </form>
      )}
      <p className="text-center text-xs text-muted">
        <Link to="/login" onClick={onBack} className={AUTH_LINK}>
          Back to sign in
        </Link>
      </p>
    </AuthPanel>
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
    <AuthPanel className={verifyPhase === "leaving" ? "auth-card-leaving" : undefined}>
      <form onSubmit={onFormSubmit} className="contents">
        <AuthHeading>Check your email</AuthHeading>
        <p className="text-center text-sm text-pretty text-muted">
          We sent a 6-digit code to{" "}
          <span className="font-mono [overflow-wrap:anywhere] text-text">{email}</span>. It expires
          in 10 minutes.
        </p>
        <div role="group" aria-label="Verification code">
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
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          className={cn(
            "h-10",
            shake.className,
            // `disabled` keeps the button inert through the fade, but its
            // own opacity-50 was washing the checkmark's green out.
            verified && "!bg-accent-2 disabled:opacity-100 saturate-150",
          )}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy} icon={verified ? <Check className="h-4 w-4" /> : undefined}>
            Verify and continue
          </BusyContent>
        </Button>
        <p className="text-center text-xs text-muted">
          {resent ? (
            <span role="status">New code sent</span>
          ) : (
            <button type="button" className={AUTH_LINK} onClick={onResend}>
              Send a new code
            </button>
          )}
          <span aria-hidden> · </span>
          <Link to="/login" onClick={onBack} className={AUTH_LINK}>
            Use another email
          </Link>
        </p>
      </form>
    </AuthPanel>
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
 * One line under "Create an account", only when the visitor arrived with
 * context to carry through: a link waiting to be claimed, or a checkout
 * they were mid-way into. A cold visitor gets nothing, and neither does
 * "Sign in": somebody who already has an account does not need a pitch.
 */
function SignupSubtitle({ next }: { next: string }) {
  const body = storedAnonLinks().length
    ? "Sign up to keep your link and its clicks."
    : next.startsWith("/billing")
      ? "Create your account, then check out. No card needed to create the account."
      : null;
  if (!body) return null;
  return <p className="-mt-2 text-center text-xs text-pretty text-muted">{body}</p>;
}

/** Step 3a (#64), once per mount of the signup form. */
function SignupViewed() {
  useEffect(() => {
    posthog.capture(FUNNEL.signupViewed);
  }, []);
  return null;
}

/**
 * The password, with "Forgot it?" on the right of its label line on sign-in
 * (where somebody looks the moment they are stuck) and the strength meter
 * under it on sign-up. Its own label row rather than Field's, because a
 * button inside a <label> would hand its clicks to the input.
 */
function PasswordField({
  mode,
  password,
  error,
  onForgot,
  input,
}: {
  mode: "login" | "signup";
  password: string;
  /** Why the password is wrong: on the label line, like Field's. */
  error?: string;
  onForgot: () => void;
  input: (id: string, aria: InvalidAria) => ReactNode;
}) {
  const id = useId();
  const reasonId = useId();
  return (
    <div>
      <div className="mb-1.5 flex min-h-4 items-center gap-3 text-xs text-muted">
        <label htmlFor={id} className="shrink-0">
          Password
        </label>
        <span className="ml-auto flex min-w-0 items-center gap-3">
          {error && <FieldReason id={reasonId} reason={error} />}
          {mode === "login" && (
            <button type="button" className={cn(AUTH_LINK, "shrink-0")} onClick={onForgot}>
              Forgot it?
            </button>
          )}
        </span>
      </div>
      {/* The input is the peer: its aria-invalid shows the ×. */}
      <span className="relative block">
        {input(id, invalidAria(error, reasonId))}
        <InvalidMark className="hidden peer-aria-invalid:block" />
      </span>
      {mode === "signup" && (
        <span className="mt-1.5 block text-xs text-muted">
          <PasswordMeter password={password} />
        </span>
      )}
    </div>
  );
}

/** Email and password, each marked with its own reason when it is wrong. */
function CredentialFields({
  mode,
  register,
  errors,
  password,
  onForgot,
}: {
  mode: "login" | "signup";
  register: UseFormRegister<AuthForm>;
  errors: FieldErrors<AuthForm>;
  password: string;
  onForgot: () => void;
}) {
  return (
    <>
      <Field label="Email" error={errors.email?.message}>
        <Input
          type="email"
          {...register("email")}
          autoComplete="email"
          placeholder="you@company.com"
          className="h-10"
        />
      </Field>
      <PasswordField
        mode={mode}
        password={password}
        error={errors.password?.message}
        onForgot={onForgot}
        input={(id, aria) => (
          <Input
            id={id}
            type="password"
            {...register("password")}
            {...aria}
            autoComplete={AUTH_MODE_COPY[mode].passwordAutoComplete}
            className="peer h-10 aria-invalid:pr-8"
          />
        )}
      />
    </>
  );
}

/**
 * The Google sign-in control. A plain button by default; when this browser
 * last signed in with Google and we kept the address, it becomes a
 * one-click "continue as you@…" row instead.
 */
function GoogleButton({
  email,
  onClick,
  disabled,
}: {
  email?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const off = disabled
    ? { disabled: true, title: GOOGLE_OFF, "aria-describedby": "google-off" }
    : {};
  if (!email) {
    return (
      <button
        type="button"
        onClick={onClick}
        {...off}
        className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-surface text-sm font-semibold smooth-shadow-ring-xs transition-[background-color,scale] duration-200 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:disabled:hover:bg-surface"
      >
        <GoogleG />
        Continue with Google
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      {...off}
      aria-label={`Continue as ${email}`}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-lg bg-surface px-3 text-sm smooth-shadow-ring-xs transition-[background-color,scale] duration-200 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:disabled:hover:bg-surface"
    >
      <GoogleG />
      <span className="min-w-0 flex-1 truncate text-left font-medium">{email}</span>
      <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-2xs font-medium text-accent">
        Last used
      </span>
      <ArrowRight size={16} className="shrink-0 text-muted" />
    </button>
  );
}

const GOOGLE_OFF = "Google sign-in is not available here";

function GoogleEntry(props: { email?: string; onClick: () => void; disabled: boolean }) {
  return (
    <>
      <GoogleButton {...props} />
      {/* The reason, for a screen reader: title is not announced, and a
          disabled button cannot take focus to show anything else. */}
      {props.disabled && (
        <span id="google-off" className="sr-only">
          {GOOGLE_OFF}
        </span>
      )}
    </>
  );
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
  challenge,
}: {
  mode: "login" | "signup";
  busy: boolean;
  shake: ReturnType<typeof useShake>;
  next: string;
  onSubmit: (email: string, password: string) => void;
  onForgot: (email: string) => void;
  /** Starts the Turnstile challenge (#304). Idempotent, so a per-keystroke
   * handler is fine; it fires once and the work overlaps the typing. */
  onFirstInput: () => void;
  /** Sign-up's Turnstile challenge. Login never starts it, so it never shows. */
  challenge: TurnstileChallenge;
}) {
  const copy = AUTH_MODE_COPY[mode];
  const button = guardedButton(busy, challenge);
  const config = useConfig();
  // Read once on mount: a returning visitor who last signed in with Google
  // gets a one-click "continue as you" row.
  const [lastUsed] = useState(lastAuth);
  // Step 3b (#64): what separates "reached the form" from "typed in it".
  // Signup only; the login form is not a funnel.
  const started = useRef(false);
  const onInput = () => {
    if (mode === "signup" && !started.current) {
      started.current = true;
      posthog.capture(FUNNEL.signupStarted);
    }
    onFirstInput();
  };
  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors },
  } = useForm<AuthForm>({
    resolver: valibotResolver(copy.schema),
    defaultValues: { email: "", password: "" },
  });

  const startGoogle = () => {
    setLastAuth("google");
    posthog.capture("user_google_signin_started");
    // Full-page redirect to Google; returns to /api/auth/callback/google, then
    // to `next`. Same flow on login and signup (account linking handles an
    // existing email/password account).
    void authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      newUserCallbackURL: googleSignupUrl(next),
    });
  };

  const password = watch("password");
  const onFormSubmit = handleSubmit(
    (data) => onSubmit(data.email, data.password),
    (errors) => {
      if (mode === "signup")
        posthog.capture(SIGNUP_FAILED, { reason: `invalid_${Object.keys(errors).join("_")}` });
      // The fields carry the reasons; react-hook-form focuses the first.
      shake.start();
    },
  );

  return (
    <AuthPanel>
      <form onSubmit={onFormSubmit} onInput={onInput} noValidate className="contents">
        <AuthHeading>{copy.title}</AuthHeading>
        {mode === "signup" && <SignupSubtitle next={next} />}
        <InviteBanner next={next} />
        {mode === "signup" && <SignupViewed />}
        {/* Keep the Google row in place while configuration loads. Enable it
            only when this server has Google credentials. */}
        <GoogleEntry
          email={lastUsed?.method === "google" ? lastUsed.email : undefined}
          onClick={startGoogle}
          disabled={!config.data?.googleEnabled}
        />
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <CredentialFields
          mode={mode}
          register={register}
          errors={errors}
          password={password}
          onForgot={() => onForgot(getValues("email"))}
        />
        {mode === "signup" && <TurnstileSlot challenge={challenge} />}
        <Button
          type="submit"
          variant="primary"
          disabled={button.disabled}
          className={cn("h-10", shake.className)}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={button.spinning}>
            {button.waiting ? CHALLENGE_LABEL : copy.submitLabel}
          </BusyContent>
        </Button>
        <p className="text-center text-xs text-muted">
          {copy.footerPrompt}{" "}
          <HrefLink
            href={`${copy.footerTo}?next=${encodeURIComponent(next)}`}
            className={AUTH_LINK}
          >
            {copy.footerLabel}
          </HrefLink>
        </p>
      </form>
    </AuthPanel>
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
  /** Runs a Turnstile-guarded request, re-solving once if the token is refused. */
  turnstileGuarded: <T>(run: (headers: Record<string, string>) => Promise<T>) => Promise<T>;
}

async function trySignIn(email: string, password: string, deps: SubmitDeps) {
  const { error: signInError } = await authClient.signIn.email({ email, password });
  if (!signInError) {
    setLastAuth("password", email);
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
  deps: SubmitDeps & { emailEnabled: boolean },
) {
  // Turnstile token (#304). Solved while the visitor was typing,
  // spent here, and required by the Worker before an account exists. Through
  // the guard, so a token the server has forgotten is solved again rather
  // than shown to somebody as an error.
  const { data: signup, error: signUpError } = await deps.turnstileGuarded((headers) =>
    authClient.signUp.email({ email, password, name: email.split("@")[0] }, { headers }),
  );
  if (signUpError) {
    posthog.capture(SIGNUP_FAILED, { reason: signUpError.code ?? `http_${signUpError.status}` });
    deps.failSubmit(friendlyAuthError(signUpError));
  } else {
    // Funnel step 4 (#64), at the boundary that actually means "an account
    // was accepted". Before goVerify, so a failure to send the code cannot
    // lose the signup that already happened.
    captureEmailSignup(posthog.capture, signup);
    // No email provider: there is no code to send, so the account is already
    // usable. Sign in with what was just typed.
    if (deps.emailEnabled) await deps.goVerify(email);
    else await trySignIn(email, password, deps);
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
  if (sess?.data) {
    setLastAuth("password", deps.authEmail);
    return true;
  }
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
  setLastAuth("password", deps.authEmail);
  return true;
}

/** The stretch after the code is accepted and a session exists: a beat on the
 * green checkmark so acceptance registers, then the card fades before the
 * page changes. Out here because none of it is state, it is a sequence, and
 * it was the bulk of what made runVerify hard to read. */
async function finishVerifiedSignIn(deps: {
  next: string;
  qc: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setVerifyPhase: (phase: "idle" | "success" | "leaving") => void;
}) {
  deps.setVerifyPhase("success");
  await new Promise((resolve) => setTimeout(resolve, 900));
  clearPending();
  await deps.qc.refetchQueries({ queryKey: ["user"] });
  const isAdmin = deps.qc.getQueryData<CurrentUser | null>(["user"])?.user.isAdmin ?? false;
  deps.setVerifyPhase("leaving");
  await new Promise((resolve) => setTimeout(resolve, 300));
  deps.navigate({ href: sanitizeNext(deps.next, isAdmin), replace: true });
}

/** The password-reset flow, which shares nothing with the rest of the page
 * but the view it switches to and the toast it complains through. */
function useForgotPassword(
  setView: (view: View) => void,
  toast: ReturnType<typeof useToast>,
  emailEnabled: boolean,
) {
  const resetTurnstile = useTurnstile("password-reset");
  const [forgotBusy, setForgotBusy] = useState(false);

  const submitForgot = async (email: string) => {
    if (!emailEnabled) {
      toast("This instance has no email provider, so passwords cannot be reset by email.", "error");
      return;
    }
    setForgotBusy(true);
    try {
      // Cheap to abuse and it sends mail, which is why #50 needed a
      // per-recipient cap. Turnstile gates the attempt instead (#304).
      const { error: resetError } = await resetTurnstile.guarded((headers) =>
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

  return { forgotBusy, submitForgot, resetChallenge: resetTurnstile.challenge };
}

/** Landing on /login or /signup while already signed in. Only a fallback:
 * during the OTP success/leaving sequence runVerify owns the redirect, and
 * this would race ahead of it the moment the `user` query refetch resolves,
 * skipping the transition entirely. */
function useRedirectWhenSignedIn(deps: {
  verifyPhase: "idle" | "success" | "leaving";
  next: string;
}) {
  const { data: user, isPending } = useCurrentUser();
  const [authHint] = useState(readAuthHint);
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
  return verifyPhase === "idle" && (!!user || (authHint && isPending));
}

/** Login/signup state machine: view transitions, the OTP/password-reset
 * flows, and the post-auth redirect. Everything AuthPage's views need. */
function useAuthFlow(mode: "login" | "signup") {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const pending = readPending();
  const [chosenView, setView] = useState<View | null>(null);
  const view = chosenView ?? (pending ? "verify-otp" : "form");
  const [chosenEmail, setAuthEmail] = useState<string | null>(null);
  const authEmail = chosenEmail ?? pending?.email ?? "";
  const authPasswordRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<"idle" | "success" | "leaving">("idle");
  const shake = useShake();
  // Two scopes, two tokens: one minted for signup must not be spendable on a
  // password reset, so the scope is bound into the token (Turnstile action). The reset one
  // lives in useForgotPassword, which is the only thing that spends it.
  const signupTurnstile = useTurnstile("signup");
  // Treated as on until the config answers: the only wrong guess is showing a
  // code screen, which the server never sends to, and config is cached.
  const emailEnabled = useConfig().data?.emailEnabled ?? true;

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
  // query string is the only source for where to send them back. Read once:
  // the moment sign-in navigates to `next` the query string is gone, and this
  // page renders once more before it unmounts. Read live, `next` fell back to
  // /dashboard on that render and useRedirectWhenSignedIn replaced the page
  // the visitor had just been sent to (an invite was never accepted).
  const [next] = useState(() => {
    const raw = readPending()?.next ?? params.get("next") ?? "/dashboard";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  });

  const { forgotBusy, submitForgot, resetChallenge } = useForgotPassword(
    setView,
    toast,
    emailEnabled,
  );
  const redirecting = useRedirectWhenSignedIn({ verifyPhase, next });

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
      const deps = {
        goVerify,
        failSubmit,
        qc,
        navigate,
        next,
        turnstileGuarded: signupTurnstile.guarded,
      };
      await (mode === "login"
        ? trySignIn(email, password, deps)
        : trySignUp(email, password, { ...deps, emailEnabled }));
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
      // Fire here, not after establishSessionAfterVerify: the account is
      // created and verified at this point regardless of whether we can
      // also sign them in (e.g. authPasswordRef was lost to a reload).
      //
      // Not gated on `mode`: goVerify is only ever reached while the account
      // is unverified (trySignUp fresh, or trySignIn's EMAIL_NOT_VERIFIED
      // retry), so a successful verifyEmail here is always that account's
      // one-time activation, whether the visitor is currently on /signup or
      // came back through /login to finish an abandoned signup. Gating on
      // `mode === "signup"` undercounted exactly that second case.
      posthog.capture(USER_SIGNED_UP, { method: "email" });
      // Funnel step 5b (#64).
      posthog.capture(FUNNEL.verificationCompleted);
      const established = await establishSessionAfterVerify({
        authEmail,
        authPassword: authPasswordRef.current,
        next,
        navigate,
        toast,
      });
      if (!established) return false;
      await finishVerifiedSignIn({ next, qc, navigate, setVerifyPhase });
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
    redirecting,
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
    /** Hung on the forms' first interaction so the Turnstile challenge runs while
     * the visitor types, instead of stalling the submit. Signup only: a
     * password reset is rare enough that a short wait on submit is fine, and
     * priming it would tax everyone who came to log in. */
    primeSignupTurnstile: signupTurnstile.prime,
    signupChallenge: signupTurnstile.challenge,
    resetChallenge,
  };
}

function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const flow = useAuthFlow(mode);
  if (flow.redirecting) return <div className="min-h-dvh bg-bg" />;

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
        challenge={flow.resetChallenge}
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
      onFirstInput={flow.primeSignupTurnstile}
      challenge={flow.signupChallenge}
      onForgot={(email) => {
        flow.setAuthEmail(email);
        flow.setView("forgot");
      }}
    />
  );
}

export const LoginPage = () => <AuthPage mode="login" />;
export const SignupPage = () => <AuthPage mode="signup" />;
