import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import type { OrgPlan } from "@/shared/types";
import { AuthHeading, AuthPanel } from "../components/auth-panel";
import { useAwaitWebhook } from "../lib/await-webhook";
import { useCurrentOrg } from "../lib/current-org";
import { useCheckout, useConfirmCheckout, useCurrentUser } from "../lib/hooks";
import { PLAN_NAME, planIntentFrom, priceLine, startSetup, type PlanIntent } from "../lib/setup";
import { isAppPage, SETUP_ARRIVE } from "../lib/setup-arrive";
import { loadShell } from "../lib/shell-loader";
import { useWelcomeList } from "../lib/setup-steps";
import { useSearchParams } from "../lib/router-search";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Spinner } from "../ui/spinner";

/**
 * Between a pricing link and the app.
 *
 * A sign-up from a pricing link lands here with the plan in the URL and goes
 * straight on to Polar, so the app never flashes up before the person leaves
 * it. Polar sends them back here both ways (src/worker/routes/billing.ts,
 * `from: "welcome"`): paid, this card waits for the webhook and says the plan
 * is on; gone back, it says nothing was charged. Either way the card then
 * becomes the org switcher as the app builds around it, and the setup list
 * opens with the plan as its first row.
 */

type Phase = "opening" | "failed" | "confirming" | "slow" | "on" | "cancelled" | "google";

/** What the URL asks for. Pure, because render may run it twice; the page
 * strips the URL in an effect, so a reload is a plain visit that moves on to
 * the dashboard. */
function readArrival(search: URLSearchParams) {
  const checkoutId = search.get("checkout_id");
  const cancelled = search.get("checkout") === "cancelled";
  const google = search.get("via") === "google";
  const phase: Phase = google
    ? "google"
    : checkoutId
      ? "confirming"
      : cancelled
        ? "cancelled"
        : "opening";
  const next = search.get("next") ?? "";
  return {
    intent: planIntentFrom(search),
    checkoutId,
    phase,
    // Back from Google (routes/auth.tsx): where the sign-in was going, if it
    // is a page of the app; the dashboard otherwise.
    target: google && isAppPage(next) ? next : "/dashboard",
    newAccount: search.get("signup") === "google",
  };
}

/**
 * Into the app, once: the card becomes the org switcher (SETUP_ARRIVE).
 * The list opens, with the plan row when somebody came for one, only where
 * the dashboard would open it too (useWelcomeList): an existing account
 * that comes through a pricing link keeps its dashboard as it was. An
 * account with no org left just goes to the dashboard, which asks for one.
 */
function useEnterApp(intent: PlanIntent | null, target: string) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { org } = useCurrentOrg();
  const list = useWelcomeList();
  const [delay, setDelay] = useState<number | null>(null);
  const entered = useRef(false);
  const ready = delay !== null && !!user.data && list.known;
  useEffect(() => {
    if (!ready || entered.current) return;
    entered.current = true;
    window.setTimeout(() => {
      if (org && list.listed) startSetup(org.id, intent ?? undefined);
      if (org) void navigate({ href: target, replace: true, viewTransition: SETUP_ARRIVE });
      else void navigate({ href: "/dashboard", replace: true });
    }, delay);
  });
  return {
    enterApp: (wait: number) => setDelay((current) => current ?? wait),
    listed: list.listed,
  };
}

/** A pricing link: off to Polar, unless there is nothing to buy. */
function useOpenCheckout(
  phase: Phase,
  intent: PlanIntent | null,
  plan: OrgPlan | undefined,
  onFail: () => void,
  enterApp: (delay: number) => void,
) {
  const checkout = useCheckout();
  const opened = useRef(false);
  useEffect(() => {
    if (phase !== "opening" || !plan || opened.current) return;
    opened.current = true;
    if (!intent || plan !== "free") {
      enterApp(0);
      return;
    }
    checkout.mutate(
      { plan: intent.target, interval: intent.interval, from: "welcome" },
      { onSuccess: ({ url }) => window.location.assign(url), onError: onFail },
    );
  });
  return () => {
    opened.current = false;
  };
}

/** Back from a paid checkout: the plan turning paid is the webhook landing.
 * Past the poll, Polar is asked directly, as the billing page does. */
function useConfirmPayment(
  phase: Phase,
  checkoutId: string | null,
  plan: OrgPlan | undefined,
  setPhase: (phase: Phase) => void,
) {
  const qc = useQueryClient();
  const confirm = useConfirmCheckout();
  useAwaitWebhook({
    waiting: phase === "confirming" && !!plan,
    arrived: !!plan && plan !== "free",
    onArrived: () => setPhase("on"),
    onGaveUp: async () => {
      const confirmed = checkoutId ? await confirm.mutateAsync(checkoutId).catch(() => null) : null;
      const paid = !!confirmed && confirmed.plan !== "free";
      if (paid) await qc.refetchQueries({ queryKey: ["user"] });
      setPhase(paid ? "on" : "slow");
    },
  });
}

/** Polar answered after the card gave up waiting: keep asking, slowly, and
 * say so the moment the plan turns paid. */
function useLateWebhook(phase: Phase, plan: OrgPlan | undefined, setPhase: (p: Phase) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    if (phase !== "slow") return;
    if (plan && plan !== "free") {
      setPhase("on");
      return;
    }
    const id = window.setInterval(() => void qc.refetchQueries({ queryKey: ["user"] }), 5000);
    return () => window.clearInterval(id);
  }, [phase, plan, qc, setPhase]);
}

/** How long each closing card stays up before the app takes over. */
const HOLD = { on: 1100, cancelled: 1400, google: 900 } satisfies Partial<Record<Phase, number>>;
const holdFor = (phase: Phase): number | undefined =>
  phase === "on" || phase === "cancelled" || phase === "google" ? HOLD[phase] : undefined;

/** Back from Google: the shell's code and the dashboard's data load while
 * the card says so, the way the email code's green check does. */
function usePreloadApp(phase: Phase, target: string) {
  const router = useRouter();
  useEffect(() => {
    if (phase !== "google") return;
    void loadShell();
    if (target === "/dashboard") void router.preloadRoute({ to: "/dashboard" });
  }, [phase, target, router]);
}

export function WelcomePage() {
  const [params] = useSearchParams();
  const [arrival] = useState(() => readArrival(params));
  const { intent, checkoutId, target, newAccount } = arrival;
  const [phase, setPhase] = useState<Phase>(arrival.phase);
  const plan = useCurrentUser().data?.user.plan;
  const { org } = useCurrentOrg();
  const { enterApp, listed } = useEnterApp(intent, target);
  usePreloadApp(phase, target);
  useLateWebhook(phase, plan, setPhase);
  const retry = useOpenCheckout(phase, intent, plan, () => setPhase("failed"), enterApp);
  useConfirmPayment(phase, checkoutId, plan, setPhase);

  useEffect(() => {
    if (window.location.search) window.history.replaceState({}, "", "/welcome");
  }, []);
  useEffect(() => {
    const hold = holdFor(phase);
    if (hold !== undefined) enterApp(hold);
  });

  const name = intent ? PLAN_NAME[intent.target] : "Your plan";
  const words =
    phase === "google"
      ? googleCopy(newAccount)
      : copyFor(phase, name, intent, org?.name ?? "Your organization", listed);
  return (
    <AuthPanel>
      <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
        <Mark phase={phase} />
        <AuthHeading>{words.heading}</AuthHeading>
        {words.body && <p className="text-sm text-pretty text-muted">{words.body}</p>}
        {phase === "failed" && (
          <div className="mt-1 flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                retry();
                setPhase("opening");
              }}
            >
              Try again
            </Button>
            <Button variant="outline" onClick={() => enterApp(0)}>
              Start free
            </Button>
          </div>
        )}
        {phase === "slow" && (
          <Button variant="outline" className="mt-1" onClick={() => enterApp(0)}>
            Go to your dashboard
          </Button>
        )}
      </div>
    </AuthPanel>
  );
}

/** What the card says in each phase. */
interface WelcomeCopy {
  heading: string;
  body: string;
}

function copyFor(
  phase: Phase,
  name: string,
  intent: PlanIntent | null,
  orgName: string,
  listed: boolean,
): WelcomeCopy {
  switch (phase) {
    case "opening":
      return {
        heading: "Opening checkout",
        body: intent ? `${name}, ${priceLine(intent)}.` : "One moment.",
      };
    case "failed":
      return {
        heading: "Checkout did not open",
        body: "Your account is ready. Try again, or start free and upgrade from the list.",
      };
    case "confirming":
      return { heading: "Confirming your payment", body: "This takes a few seconds." };
    case "slow":
      return {
        heading: "Still confirming",
        body: "Polar has not told us yet. Billing shows your plan the moment it does.",
      };
    case "on":
      return { heading: `${name} is on`, body: `Thanks. ${orgName} has everything in ${name}.` };
    case "cancelled":
      return {
        heading: "No charge made",
        body: cancelledBody(name, listed),
      };
    case "google":
      // The page asks googleCopy, which knows whether the account is new.
      return googleCopy(false);
  }
}

/** Back from Google, before the card becomes the org switcher. */
const googleCopy = (newAccount: boolean): WelcomeCopy => ({
  heading: "Signed in with Google",
  body: newAccount ? "Your account is ready." : "",
});

/** Only promise the list when there will be one (useWelcomeList). */
const cancelledBody = (name: string, listed: boolean) =>
  listed
    ? `You are on Free. ${name} waits at the top of your list.`
    : "You are on Free. Upgrade any time from Billing.";

/** The round mark above the heading: a spinner while waiting, a check once
 * the plan is on, nothing when there is nothing to wait for. */
function Mark({ phase }: { phase: Phase }) {
  if (phase !== "opening" && phase !== "confirming" && phase !== "on" && phase !== "google")
    return null;
  const on = phase === "on" || phase === "google";
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 place-items-center rounded-full transition-[background-color,box-shadow] duration-200",
        on ? "bg-accent-2 text-bg" : "text-accent shadow-[inset_0_0_0_1.5px_var(--border)]",
      )}
    >
      {on ? <Check size={18} stroke={2.6} /> : <Spinner />}
    </span>
  );
}
