import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import type { OrgPlan } from "@/shared/types";
import { AuthHeading, AuthPanel } from "../components/auth-panel";
import { SetupFlow, type Payment } from "../components/setup-flow";
import { Unreachable } from "../components/unreachable";
import { useAwaitWebhook } from "../lib/await-webhook";
import { useCurrentOrg } from "../lib/current-org";
import { useCheckout, useConfirmCheckout, useCurrentUser } from "../lib/hooks";
import {
  finishSetup,
  flowAtCheckout,
  PLAN_NAME,
  planIntentFrom,
  priceLine,
  startSetup,
  useOrgSetup,
  type PlanIntent,
} from "../lib/setup";
import { arriveInFlow, isAppPage, SETUP_ARRIVE } from "../lib/setup-arrive";
import { useWelcomeList } from "../lib/setup-gate";
import { loadShell } from "../lib/shell-loader";
import { useSearchParams } from "../lib/router-search";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Spinner } from "../ui/spinner";

type Phase = "opening" | "failed" | "confirming" | "slow" | "on" | "cancelled" | "google" | "flow";

/** Pure, because render may run it twice; the page strips the URL in an effect. */
function readArrival(search: URLSearchParams) {
  const checkoutId = search.get("checkout_id");
  const cancelled = search.get("checkout") === "cancelled";
  const phase = arrivalPhase(search.get("via"), checkoutId, cancelled);
  const next = search.get("next") ?? "";
  return {
    intent: planIntentFrom(search),
    checkoutId,
    cancelled,
    phase,
    target: isAppPage(next) ? next : "/dashboard",
    newAccount: search.get("signup") === "google",
  };
}

function arrivalPhase(via: string | null, checkoutId: string | null, cancelled: boolean): Phase {
  if (via === "email") return "flow";
  if (via === "google") return "google";
  if (!checkoutId && !cancelled) return "opening";
  if (flowAtCheckout()) return "flow";
  return checkoutId ? "confirming" : "cancelled";
}

function useEnterApp(target: string) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { org } = useCurrentOrg();
  const [delay, setDelay] = useState<number | null>(null);
  const signedIn = !!user.data;
  const enter = useEffectEvent(() => {
    if (org) void navigate({ href: target, replace: true, viewTransition: SETUP_ARRIVE });
    else void navigate({ href: "/dashboard", replace: true });
  });
  useEffect(() => {
    if (delay === null || !signedIn) return;
    const timer = window.setTimeout(enter, delay);
    return () => window.clearTimeout(timer);
  }, [delay, signedIn]);
  return (wait: number) => setDelay((current) => current ?? wait);
}

function useOpenCheckout(
  phase: Phase,
  intent: PlanIntent | null,
  plan: OrgPlan | undefined,
  ready: boolean,
  onFail: () => void,
  onNothingToBuy: () => void,
) {
  const checkout = useCheckout();
  const opened = useRef(false);
  useEffect(() => {
    if (phase !== "opening" || !plan || !ready || opened.current) return;
    opened.current = true;
    if (!intent || plan !== "free") {
      onNothingToBuy();
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

/** The plan turning paid is the webhook landing. Past the poll, Polar is asked directly, as billing does. */
function useConfirmPayment(
  waiting: boolean,
  checkoutId: string | null,
  plan: OrgPlan | undefined,
  onPaid: () => void,
  onSlow: () => void,
) {
  const qc = useQueryClient();
  const confirm = useConfirmCheckout();
  useAwaitWebhook({
    waiting: waiting && !!plan,
    arrived: !!plan && plan !== "free",
    onArrived: onPaid,
    onGaveUp: async () => {
      const confirmed = checkoutId ? await confirm.mutateAsync(checkoutId).catch(() => null) : null;
      const paid = !!confirmed && confirmed.plan !== "free";
      if (paid) await qc.refetchQueries({ queryKey: ["user"] });
      if (paid) onPaid();
      else onSlow();
    },
  });
}

function usePayment(
  arrival: { phase: Phase; checkoutId: string | null },
  phase: Phase,
  setPhase: (phase: Phase) => void,
  plan: OrgPlan | undefined,
) {
  const [payment, setPayment] = useState<Payment>(
    arrival.phase === "flow" && arrival.checkoutId ? "confirming" : null,
  );
  const inFlow = phase === "flow";
  const onPaid = () => (inFlow ? setPayment("paid") : setPhase("on"));
  useLateWebhook(phase === "slow" || payment === "slow", plan, onPaid);
  useConfirmPayment(
    phase === "confirming" || payment === "confirming",
    arrival.checkoutId,
    plan,
    onPaid,
    () => (inFlow ? setPayment("slow") : setPhase("slow")),
  );
  return payment;
}

function useLateWebhook(slow: boolean, plan: OrgPlan | undefined, onPaid: () => void) {
  const qc = useQueryClient();
  const paid = useEffectEvent(onPaid);
  useEffect(() => {
    if (!slow) return;
    if (plan && plan !== "free") {
      paid();
      return;
    }
    const id = window.setInterval(() => void qc.refetchQueries({ queryKey: ["user"] }), 5000);
    return () => window.clearInterval(id);
  }, [slow, plan, qc]);
}

function usePreloadApp(target: string) {
  const router = useRouter();
  useEffect(() => {
    void loadShell();
    if (target === "/dashboard") void router.preloadRoute({ to: "/dashboard" });
  }, [target, router]);
}

const ORG_DATA = new Set(["stats", "links", "linkQuotaUsage", "user"]);

const HOLD = { on: 1400, cancelled: 1600, google: 1600 } satisfies Partial<Record<Phase, number>>;
const holdFor = (phase: Phase): number | undefined =>
  phase === "on" || phase === "cancelled" || phase === "google" ? HOLD[phase] : undefined;

function useMoveOn(
  phase: Phase,
  intent: PlanIntent | null,
  fromCheckout: boolean,
  enterApp: (wait: number) => void,
  setPhase: (phase: Phase) => void,
) {
  const { org } = useCurrentOrg();
  const list = useWelcomeList(fromCheckout);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const moveOn = (hold: number) => {
    if (!list.known) return;
    if (!list.listed || !org) return enterApp(hold);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      startSetup(org.id, intent ?? undefined);
      arriveInFlow(() => setPhase("flow"));
    }, hold);
  };
  const moved = useRef(false);
  useEffect(() => {
    const hold = holdFor(phase);
    if (hold === undefined || moved.current || !list.known) return;
    moved.current = true;
    moveOn(hold);
  });
  return { moveOn, known: list.known };
}

/** Only a 401 (`null`) means signed out; a failed request is not (#487). */
function useSignedIn() {
  const navigate = useNavigate();
  const current = useCurrentUser();
  const signedOut = current.data === null;
  useEffect(() => {
    if (!signedOut) return;
    const here = window.location.pathname + window.location.search;
    void navigate({ href: `/login?next=${encodeURIComponent(here)}`, replace: true });
  }, [signedOut, navigate]);
}

/** /welcome sits outside RequireAuth, so it says an outage itself. The arrival is read above the outage:
 * a Retry that remounted Welcome would lose Polar's checkout id and `next`. */
export function WelcomePage() {
  const current = useCurrentUser();
  const [params] = useSearchParams();
  const [arrival] = useState(() => readArrival(params));
  if (current.isError && current.data === undefined)
    return <Unreachable onRetry={() => void current.refetch()} retrying={current.isFetching} />;
  return <Welcome arrival={arrival} />;
}

function Welcome({ arrival }: { arrival: ReturnType<typeof readArrival> }) {
  useSignedIn();
  const { intent, checkoutId, target, newAccount } = arrival;
  const fromCheckout = !!checkoutId || arrival.phase === "cancelled";
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- `arrival` is read once in WelcomePage and never changes; it only seeds the phase machine, which moves on its own from there.
  const [phase, setPhase] = useState<Phase>(arrival.phase);
  const user = useCurrentUser().data?.user;
  const { org } = useCurrentOrg();
  const enterApp = useEnterApp(target);
  const [entering] = useState(() => arrival.phase !== "flow");
  usePreloadApp(target);
  const payment = usePayment(arrival, phase, setPhase, user?.plan);
  const { moveOn, known } = useMoveOn(phase, intent, fromCheckout, enterApp, setPhase);
  const retry = useOpenCheckout(
    phase,
    intent,
    user?.plan,
    known,
    () => setPhase("failed"),
    () => moveOn(0),
  );
  useEffect(() => {
    if (window.location.search) window.history.replaceState({}, "", "/welcome");
  }, []);

  if (phase === "flow")
    return (
      <WelcomeFlow
        intent={intent}
        fromCheckout={fromCheckout}
        cancelled={arrival.cancelled}
        payment={payment}
        enterApp={enterApp}
      />
    );
  return (
    <WelcomeCard
      phase={phase}
      entering={entering}
      words={cardWords(phase, intent, newAccount, user?.email, org?.name)}
      onRetry={() => {
        retry();
        setPhase("opening");
      }}
      onMoveOn={() => moveOn(0)}
    />
  );
}

function cardWords(
  phase: Phase,
  intent: PlanIntent | null,
  newAccount: boolean,
  email = "",
  orgName = "Your organization",
): WelcomeCopy {
  if (phase === "google") return googleCopy(newAccount, email);
  return copyFor(phase, intent ? PLAN_NAME[intent.target] : "Your plan", intent, orgName);
}

function WelcomeCard({
  phase,
  entering,
  words,
  onRetry,
  onMoveOn,
}: {
  phase: Phase;
  entering: boolean;
  words: WelcomeCopy;
  onRetry: () => void;
  onMoveOn: () => void;
}) {
  return (
    <AuthPanel className={entering ? "welcome-enter" : undefined}>
      <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
        <Mark phase={phase} />
        <AuthHeading>{words.heading}</AuthHeading>
        {words.body && <p className="text-sm text-pretty text-muted">{words.body}</p>}
        {phase === "failed" && (
          <div className="mt-1 flex gap-2">
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
            <Button variant="outline" onClick={onMoveOn}>
              Start free
            </Button>
          </div>
        )}
        {phase === "slow" && (
          <Button variant="outline" className="mt-1" onClick={onMoveOn}>
            Continue
          </Button>
        )}
      </div>
    </AuthPanel>
  );
}

function useAdmitted(fromCheckout: boolean) {
  const list = useWelcomeList(fromCheckout);
  const [admitted, setAdmitted] = useState(false);
  if (list.listed && !admitted) setAdmitted(true);
  return { admitted, skip: list.known && !list.listed && !admitted };
}

function useResume(orgId: string, intent: PlanIntent | null) {
  const setup = useOrgSetup(orgId);
  return { intent: setup?.plan ?? intent, at: setup?.at ?? ("name" as const) };
}

function useFlowGate(
  intent: PlanIntent | null,
  fromCheckout: boolean,
  enterApp: (wait: number) => void,
) {
  const { org } = useCurrentOrg();
  const { admitted, skip } = useAdmitted(fromCheckout);
  const resume = useResume(org?.id ?? "", intent);
  useEffect(() => {
    if (skip) enterApp(0);
    else if (admitted && org) startSetup(org.id, intent ?? undefined);
  });
  return { org, skip, resume };
}

function WelcomeFlow({
  intent,
  fromCheckout,
  cancelled,
  payment,
  enterApp,
}: {
  intent: PlanIntent | null;
  fromCheckout: boolean;
  cancelled: boolean;
  payment: Payment;
  enterApp: (wait: number) => void;
}) {
  const qc = useQueryClient();
  const { org, skip, resume } = useFlowGate(intent, fromCheckout, enterApp);
  if (!org || skip) return <AuthPanel>{null}</AuthPanel>;
  return (
    <SetupFlow
      org={org}
      intent={resume.intent}
      start={resume.at}
      cancelled={cancelled}
      payment={payment}
      onDone={async () => {
        finishSetup(org.id);
        await qc
          .refetchQueries({ predicate: (q) => ORG_DATA.has(String(q.queryKey[0])) })
          .catch(() => {});
        enterApp(0);
      }}
    />
  );
}

interface WelcomeCopy {
  heading: string;
  body: ReactNode;
}

interface CopyContext {
  name: string;
  intent: PlanIntent | null;
  orgName: string;
}

const opening = ({ name, intent }: CopyContext): WelcomeCopy => ({
  heading: "Opening checkout",
  body: intent ? `${name}, ${priceLine(intent)}.` : "One moment.",
});

const COPY = {
  opening,
  flow: opening,
  failed: () => ({
    heading: "Checkout did not open",
    body: "Your account is ready. Try again, or start free and upgrade later.",
  }),
  confirming: () => ({
    heading: "Confirming your payment with Polar",
    body: "Polar tells us when the payment goes through, usually within seconds.",
  }),
  slow: () => ({
    heading: "Still waiting on Polar",
    body: "Polar has not told us yet. Billing shows your plan the moment it does.",
  }),
  on: ({ name, orgName }: CopyContext) => ({
    heading: `${name} is on`,
    body: `Thanks. ${orgName} has everything in ${name}.`,
  }),
  cancelled: () => ({ heading: "No charge made", body: "You are on Free. Upgrade any time." }),
  google: () => ({ heading: "Signed in with Google", body: "" }),
} satisfies Record<Phase, (context: CopyContext) => WelcomeCopy>;

function copyFor(phase: Phase, name: string, intent: PlanIntent | null, orgName: string) {
  return COPY[phase]({ name, intent, orgName });
}

function googleCopy(newAccount: boolean, email: string): WelcomeCopy {
  if (!newAccount) return { heading: "Signed in with Google", body: "" };
  return {
    heading: "Account created",
    body: (
      <>
        Signed up with Google as <span className="font-mono text-text">{email}</span>.
      </>
    ),
  };
}

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
      {on ? <Check size={18} stroke={2.6} className="welcome-check" /> : <Spinner />}
    </span>
  );
}
