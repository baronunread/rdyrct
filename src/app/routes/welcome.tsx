import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import type { OrgPlan } from "@/shared/types";
import { AuthHeading, AuthPanel } from "../components/auth-panel";
import { useAwaitWebhook } from "../lib/await-webhook";
import { useCurrentOrg } from "../lib/current-org";
import { useCheckout, useConfirmCheckout, useCurrentUser } from "../lib/hooks";
import { PLAN_NAME, planIntentFrom, priceLine, startSetup, type PlanIntent } from "../lib/setup";
import { SETUP_ARRIVE } from "../lib/setup-arrive";
import { HrefLink, useSearchParams } from "../lib/router-search";
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

type Phase = "opening" | "failed" | "confirming" | "slow" | "on" | "cancelled";

/** What the URL asks for. Pure, because render may run it twice; the page
 * strips the URL in an effect, so a reload is a plain visit that moves on to
 * the dashboard. */
function readArrival(search: URLSearchParams) {
  const checkoutId = search.get("checkout_id");
  const cancelled = search.get("checkout") === "cancelled";
  const phase: Phase = checkoutId ? "confirming" : cancelled ? "cancelled" : "opening";
  return { intent: planIntentFrom(search), checkoutId, phase };
}

/** Into the app, once: the card becomes the org switcher (SETUP_ARRIVE), and
 * the list opens with the plan row when somebody came for one. */
function useEnterApp(intent: PlanIntent | null) {
  const navigate = useNavigate();
  const { org } = useCurrentOrg();
  const entered = useRef(false);
  return (delay: number) => {
    if (entered.current || !org) return;
    entered.current = true;
    window.setTimeout(() => {
      startSetup(org.id, intent ?? undefined);
      void navigate({ to: "/dashboard", replace: true, viewTransition: SETUP_ARRIVE });
    }, delay);
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

/** How long each closing card stays up before the app takes over. */
const HOLD = { on: 1100, cancelled: 1400 } satisfies Partial<Record<Phase, number>>;
const holdFor = (phase: Phase): number | undefined =>
  phase === "on" || phase === "cancelled" ? HOLD[phase] : undefined;

export function WelcomePage() {
  const [params] = useSearchParams();
  const [arrival] = useState(() => readArrival(params));
  const { intent, checkoutId } = arrival;
  const [phase, setPhase] = useState<Phase>(arrival.phase);
  const plan = useCurrentUser().data?.user.plan;
  const { org } = useCurrentOrg();
  const enterApp = useEnterApp(intent);
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
  const words = copyFor(phase, name, intent, org?.name ?? "Your organization");
  return (
    <AuthPanel>
      <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
        <Mark phase={phase} />
        <AuthHeading>{words.heading}</AuthHeading>
        <p className="text-sm text-pretty text-muted">{words.body}</p>
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
          <HrefLink
            href="/dashboard"
            className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            Go to your dashboard
          </HrefLink>
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
        body: `You are on Free. ${name} waits at the top of your list.`,
      };
  }
}

/** The round mark above the heading: a spinner while waiting, a check once
 * the plan is on, nothing when there is nothing to wait for. */
function Mark({ phase }: { phase: Phase }) {
  if (phase !== "opening" && phase !== "confirming" && phase !== "on") return null;
  const on = phase === "on";
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
