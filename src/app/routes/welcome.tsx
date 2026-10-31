import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import type { OrgPlan } from "@/shared/types";
import { AuthHeading, AuthPanel } from "../components/auth-panel";
import { SetupFlow } from "../components/setup-flow";
import { useAwaitWebhook } from "../lib/await-webhook";
import { useCurrentOrg } from "../lib/current-org";
import { useCheckout, useConfirmCheckout, useCurrentUser } from "../lib/hooks";
import {
  finishSetup,
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

/**
 * Between signing in and the app, for a new organization.
 *
 * The sign-in card arrives here: from the email code (routes/auth.tsx), back
 * from Google, or back from Polar after a pricing link. It says what just
 * happened, then becomes the organization card of the setup flow
 * (components/setup-flow.tsx): name, first link, domain, team. At the end
 * that card becomes the org switcher as the app builds around it.
 *
 * Only an owner whose org has no links yet gets the flow (useWelcomeList);
 * anybody else goes straight on into the app with the same hand-over.
 */

type Phase = "opening" | "failed" | "confirming" | "slow" | "on" | "cancelled" | "google" | "flow";

/** What the URL asks for. Pure, because render may run it twice; the page
 * strips the URL in an effect, so a reload is a plain visit. */
function readArrival(search: URLSearchParams) {
  const via = search.get("via");
  const checkoutId = search.get("checkout_id");
  const cancelled = search.get("checkout") === "cancelled";
  const phase: Phase =
    via === "email"
      ? "flow"
      : via === "google"
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
    // Where the sign-in was going, if it is a page of the app.
    target: isAppPage(next) ? next : "/dashboard",
    newAccount: search.get("signup") === "google",
  };
}

/** Into the app, once: the card in view (this page's, or the flow's
 * organization card) becomes the org switcher. An account with no org left
 * goes to the dashboard, which asks for one. */
function useEnterApp(target: string) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { org } = useCurrentOrg();
  const [delay, setDelay] = useState<number | null>(null);
  const entered = useRef(false);
  useEffect(() => {
    if (delay === null || !user.data || entered.current) return;
    entered.current = true;
    window.setTimeout(() => {
      if (org) void navigate({ href: target, replace: true, viewTransition: SETUP_ARRIVE });
      else void navigate({ href: "/dashboard", replace: true });
    }, delay);
  });
  return (wait: number) => setDelay((current) => current ?? wait);
}

/** A pricing link: off to Polar, unless there is nothing to buy. */
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

/** The shell's code and the dashboard's data, loading while a card is up,
 * so the hand-over lands on a page already drawn. */
function usePreloadApp(target: string) {
  const router = useRouter();
  useEffect(() => {
    void loadShell();
    if (target === "/dashboard") void router.preloadRoute({ to: "/dashboard" });
  }, [target, router]);
}

/** What the flow changed and the dashboard draws from. */
const ORG_DATA = new Set(["stats", "links", "linkQuotaUsage", "user"]);

/** How long each card stays up before it moves on. */
const HOLD = { on: 1100, cancelled: 1400, google: 1000 } satisfies Partial<Record<Phase, number>>;
const holdFor = (phase: Phase): number | undefined =>
  phase === "on" || phase === "cancelled" || phase === "google" ? HOLD[phase] : undefined;

/**
 * After a card: the flow for a new organization, the app for anybody else.
 * A returning Google sign-in is never a new organization, whatever this
 * browser remembers.
 */
function useMoveOn(
  returning: boolean,
  intent: PlanIntent | null,
  enterApp: (wait: number) => void,
  setPhase: (phase: Phase) => void,
) {
  const { org } = useCurrentOrg();
  const list = useWelcomeList();
  const moveOn = (hold: number) => {
    if (!list.known) return;
    if (returning || !list.listed || !org) return enterApp(hold);
    window.setTimeout(() => {
      startSetup(org.id, intent ?? undefined);
      arriveInFlow(() => setPhase("flow"));
    }, hold);
  };
  return { moveOn, known: list.known };
}

/** Each closing card moves on once, after its hold. */
function useHold(phase: Phase, known: boolean, moveOn: (hold: number) => void) {
  const moved = useRef(false);
  useEffect(() => {
    const hold = holdFor(phase);
    if (hold === undefined || moved.current || !known) return;
    moved.current = true;
    moveOn(hold);
  });
}

export function WelcomePage() {
  const [params] = useSearchParams();
  const [arrival] = useState(() => readArrival(params));
  const { intent, checkoutId, target, newAccount } = arrival;
  const [phase, setPhase] = useState<Phase>(arrival.phase);
  const user = useCurrentUser().data?.user;
  const { org } = useCurrentOrg();
  const enterApp = useEnterApp(target);
  usePreloadApp(target);
  useLateWebhook(phase, user?.plan, setPhase);
  useConfirmPayment(phase, checkoutId, user?.plan, setPhase);
  const { moveOn, known } = useMoveOn(
    phase === "google" && !newAccount,
    intent,
    enterApp,
    setPhase,
  );
  const retry = useOpenCheckout(
    phase,
    intent,
    user?.plan,
    known,
    () => setPhase("failed"),
    () => moveOn(0),
  );
  useHold(phase, known, moveOn);
  useEffect(() => {
    if (window.location.search) window.history.replaceState({}, "", "/welcome");
  }, []);

  if (phase === "flow") return <WelcomeFlow intent={intent} enterApp={enterApp} />;
  return (
    <WelcomeCard
      phase={phase}
      words={cardWords(phase, intent, newAccount, user?.email, org?.name)}
      onRetry={() => {
        retry();
        setPhase("opening");
      }}
      onMoveOn={() => moveOn(0)}
    />
  );
}

/** What the card says, for the phase it is in. */
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

/** The card itself, between signing in and what comes next. */
function WelcomeCard({
  phase,
  words,
  onRetry,
  onMoveOn,
}: {
  phase: Phase;
  words: WelcomeCopy;
  onRetry: () => void;
  onMoveOn: () => void;
}) {
  return (
    <AuthPanel>
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

/** Whether this org gets the flow, and where it picks up. An org that
 * does not moves on into the app; one that does has its flow started. */
function useFlowGate(intent: PlanIntent | null, enterApp: (wait: number) => void) {
  const { org } = useCurrentOrg();
  const list = useWelcomeList();
  const setup = useOrgSetup(org?.id ?? "");
  const skip = list.known && !list.listed;
  useEffect(() => {
    if (skip) enterApp(0);
    else if (list.listed && org) startSetup(org.id, intent ?? undefined);
  });
  return { org, skip, resume: { intent: setup?.plan ?? intent, at: setup?.at ?? "name" } };
}

/**
 * The flow itself. Drawn at once, so the sign-in card has the organization
 * card to become; the rare org that turns out not to get one (it already
 * had links) moves on into the app instead.
 */
function WelcomeFlow({
  intent,
  enterApp,
}: {
  intent: PlanIntent | null;
  enterApp: (wait: number) => void;
}) {
  const qc = useQueryClient();
  const { org, skip, resume } = useFlowGate(intent, enterApp);
  if (!org || skip) return <AuthPanel>{null}</AuthPanel>;
  return (
    <SetupFlow
      org={org}
      intent={resume.intent}
      start={resume.at}
      onDone={async () => {
        finishSetup(org.id);
        // The dashboard was fetched before the flow made a link; fetched
        // again so it lands as a dashboard, not as its first-run screen.
        await qc
          .refetchQueries({ predicate: (q) => ORG_DATA.has(String(q.queryKey[0])) })
          .catch(() => {});
        enterApp(0);
      }}
    />
  );
}

/** What the card says in each phase. */
interface WelcomeCopy {
  heading: string;
  body: ReactNode;
}

/** The words for a plan, an org and a phase. */
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
  confirming: () => ({ heading: "Confirming your payment", body: "This takes a few seconds." }),
  slow: () => ({
    heading: "Still confirming",
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

/** Back from Google, before the card moves on. A new account says so, with
 * the address Google gave; a returning one only that it is signed in. */
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

/** The round mark above the heading: a spinner while waiting, a check once
 * something is done, nothing when there is nothing to show. */
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
