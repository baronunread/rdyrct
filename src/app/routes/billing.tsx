import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import confetti from "canvas-confetti";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCurrentUser,
  useLinkQuotaUsage,
  useMembers,
  useDomains,
  useCheckout,
  usePortal,
  useConfirmCheckout,
} from "../lib/hooks";
import { shortDate } from "../lib/dates";
import { useCurrentOrg } from "../lib/current-org";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_PRICES_YEARLY,
  YEARLY_DISCOUNT_LABEL,
  type OrgPlan,
  type PlanLimits,
} from "@/shared/types";
import { Button } from "../ui/button";
import { Badge, Card, PageHeader, Table, Th, Td } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { Skeleton } from "../ui/skeleton";
import { BillingSkeleton } from "../components/skeletons";
import { useShake } from "../lib/use-shake";
import { showsCancelNotice, showsConfirmingNotice } from "../lib/plan-status-notes";
import { useToast } from "../ui/toast";
import posthog from "../lib/posthog";
import { shouldOfferFirstLink } from "../lib/billing-page";

/** The three shake handles the page owns, one per button it can bounce. */
type Shake = Record<"hobby" | "pro" | "portal", ReturnType<typeof useShake>>;

/** How a subscription is billed. Yearly is 10% cheaper per month. */
type BillingInterval = "month" | "year";

/** The upgrade-button label's price suffix for a plan at an interval. No
 * "billed yearly" here: the toggle right above the buttons already says
 * that, and the fixed button height (h-9) has no room for a wrapped third
 * line on the narrow two-up mobile layout. */
function priceSuffix(plan: "hobby" | "pro", interval: BillingInterval): string {
  return interval === "year" ? `${PLAN_PRICES_YEARLY[plan]}/mo` : `${PLAN_PRICES[plan]}/mo`;
}

type PlanActionSnapshot = {
  plan: OrgPlan;
  hasBillingAccount: boolean;
  comped: boolean;
  checkoutPlan: "hobby" | "pro" | null;
  showPortalOverlay: boolean;
  confirmTimedOut: boolean;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
};

type PlanActionCommands = {
  shake: Shake;
  onUpgrade: (target: "hobby" | "pro", interval: BillingInterval) => void;
  onPortal: () => void;
};

type UsageSnapshot = {
  plan: OrgPlan;
  org: { id: string; name: string; plan: OrgPlan } | null;
  linkQuotaCount: number | undefined;
  memberCount: number;
  domainCount: number;
  ownedOrgs: number;
  loading: boolean;
};

type PortalState = {
  plan: OrgPlan;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
};

const PORTAL_SNAPSHOT_KEY = "billing:portal-snapshot";

/** Everything the subscription portal can change, as one comparable string:
 * the plan, whether a cancel is scheduled, and when the period ends. Enough
 * to tell "the webhook has landed" from "it has not landed yet". */
function portalState(user?: {
  plan: OrgPlan;
  polarSubscriptionCancelAtPeriodEnd?: boolean;
  polarSubscriptionCurrentPeriodEnd?: number | null;
}): PortalState {
  if (!user) return { plan: "free", cancelAtPeriodEnd: false, periodEnd: null };
  return {
    plan: user.plan,
    cancelAtPeriodEnd: user.polarSubscriptionCancelAtPeriodEnd ?? false,
    periodEnd: user.polarSubscriptionCurrentPeriodEnd ?? null,
  };
}

function billingSnapshot(state: PortalState) {
  // JSON, not join: a join renders null as an empty string, so "no period
  // end" and "period end of ''" would compare equal and the wait would end
  // on a change that never happened.
  return JSON.stringify([state.plan, state.cancelAtPeriodEnd, state.periodEnd]);
}

const PLAN_LABEL = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
} satisfies Record<OrgPlan, string>;

const PLAN_FEATURES = [
  ["Links", `${PLAN_LIMITS.free.links}`, `${PLAN_LIMITS.hobby.links}`, `${PLAN_LIMITS.pro.links}`],
  [
    "Members",
    `${PLAN_LIMITS.free.members}`,
    `${PLAN_LIMITS.hobby.members}`,
    `${PLAN_LIMITS.pro.members}`,
  ],
  [
    "Domains",
    `${PLAN_LIMITS.free.domains}`,
    `${PLAN_LIMITS.hobby.domains}`,
    `${PLAN_LIMITS.pro.domains}`,
  ],
  [
    "Org. you own",
    `${PLAN_LIMITS.free.orgs}`,
    `${PLAN_LIMITS.hobby.orgs}`,
    `${PLAN_LIMITS.pro.orgs}`,
  ],
  ["QR codes", "Yes", "Yes", "Yes"],
  ["QR logo & colors", "No", "Yes", "Yes"],
  [
    "Analytics",
    `${PLAN_LIMITS.free.analyticsDays}d`,
    `${PLAN_LIMITS.hobby.analyticsDays}d`,
    `${PLAN_LIMITS.pro.analyticsDays}d`,
  ],
] as const;

function PlanFeatureComparison() {
  return (
    <div className="my-3 text-xs tnum">
      <Table>
        <thead>
          <tr>
            <Th />
            <Th>Free</Th>
            <Th className="text-accent">Hobby</Th>
            <Th className="text-accent">Pro</Th>
          </tr>
        </thead>
        <tbody>
          {PLAN_FEATURES.map(([label, free, hobby, pro]) => (
            <tr key={label}>
              <Td className="text-muted">{label}</Td>
              <Td>{free}</Td>
              <Td className="text-accent">{hobby}</Td>
              <Td className="text-accent">{pro}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** The cancel-scheduled and still-confirming status notes above the plan
 * actions; either, both, or neither can show depending on account state. */
function CancelScheduledNotice({ plan, periodEnd }: { plan: OrgPlan; periodEnd: number }) {
  return (
    <p className="text-sm text-amber-400">
      Your {PLAN_LABEL[plan]} plan is scheduled to cancel on {shortDate(periodEnd)}. Paid features
      remain available until then.
    </p>
  );
}

function ConfirmingPaymentNotice() {
  return (
    <p className="text-sm text-muted">
      Still confirming your payment. Your plan should activate shortly: refresh in a moment.
    </p>
  );
}

/**
 * The notes arrive on their own, seconds after the page settles, when the
 * webhook behind a portal visit lands. Appearing outright reads as a glitch,
 * so they grow in instead.
 *
 * `initial={false}` keeps that to the arrival: a note already true when the
 * page loads is simply there, with nothing to watch.
 */
function PlanStatusNotes({
  plan,
  comped,
  cancelAtPeriodEnd,
  periodEnd,
  confirmTimedOut,
}: {
  plan: OrgPlan;
  comped: boolean;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
  confirmTimedOut: boolean;
}) {
  const reduced = useReducedMotion();
  const grow = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" as const },
        exit: { opacity: 0, height: 0 },
      };
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {showsCancelNotice(cancelAtPeriodEnd, periodEnd, comped) && (
          <m.div key="cancel" {...grow} transition={{ duration: 0.2 }} className="overflow-hidden">
            <CancelScheduledNotice plan={plan} periodEnd={periodEnd} />
          </m.div>
        )}
        {showsConfirmingNotice(confirmTimedOut, plan) && (
          <m.div
            key="confirming"
            {...grow}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ConfirmingPaymentNotice />
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

/** Monthly / yearly switch. Yearly carries the discount label so the saving
 * is visible before a plan is picked. The active option's fill is one pill
 * that never unmounts: `layoutId` alone does not animate here, because a
 * plain conditional render swaps the old and new pill in the same commit
 * with no exit phase for Framer to measure a "from" rect (that needs
 * AnimatePresence, overkill for two buttons). Measuring the target button's
 * own rect and tweening one persistent element to it sidesteps that. */
function BillingCycleToggle({
  interval,
  onChange,
  disabled,
}: {
  interval: BillingInterval;
  onChange: (next: BillingInterval) => void;
  disabled: boolean;
}) {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<BillingInterval, HTMLButtonElement | null>>({
    month: null,
    year: null,
  });
  const [pillRect, setPillRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const btn = buttonRefs.current[interval];
    const container = containerRef.current;
    if (!btn || !container) return;
    const b = btn.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setPillRect({ left: b.left - c.left, top: b.top - c.top, width: b.width, height: b.height });
  }, [interval]);

  return (
    <LazyMotion features={domAnimation}>
      <div
        ref={containerRef}
        className="relative flex w-fit items-center gap-1 rounded-md border border-border bg-surface p-1 text-xs"
      >
        {pillRect && (
          <m.span
            className="absolute rounded bg-accent"
            initial={false}
            animate={pillRect}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
        {(["month", "year"] as const).map((value) => (
          <button
            key={value}
            ref={(el) => {
              buttonRefs.current[value] = el;
            }}
            type="button"
            disabled={disabled}
            aria-pressed={interval === value}
            onClick={() => onChange(value)}
            className={
              "relative rounded px-2 py-1 font-medium transition-colors disabled:opacity-50 " +
              (interval === value ? "text-bg" : "text-muted hover:text-text")
            }
          >
            {value === "month" ? "Monthly" : `Yearly · ${YEARLY_DISCOUNT_LABEL}`}
          </button>
        ))}
      </div>
    </LazyMotion>
  );
}

function FreeUpgradeButtons({
  checkoutPlan,
  shake,
  onUpgrade,
}: {
  checkoutPlan: "hobby" | "pro" | null;
  shake: Shake;
  onUpgrade: (target: "hobby" | "pro", interval: BillingInterval) => void;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const busy = checkoutPlan !== null;
  return (
    <div className="flex flex-col gap-3">
      <BillingCycleToggle interval={interval} onChange={setInterval} disabled={busy} />
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          disabled={busy}
          className={shake.hobby.className}
          onAnimationEnd={shake.hobby.end}
          onClick={() => onUpgrade("hobby", interval)}
        >
          <BusyContent busy={checkoutPlan === "hobby"}>
            Upgrade to Hobby · {priceSuffix("hobby", interval)}
          </BusyContent>
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          className={shake.pro.className}
          onAnimationEnd={shake.pro.end}
          onClick={() => onUpgrade("pro", interval)}
        >
          <BusyContent busy={checkoutPlan === "pro"}>
            Upgrade to Pro · {priceSuffix("pro", interval)}
          </BusyContent>
        </Button>
      </div>
    </div>
  );
}

function ManageSubscriptionButton({
  showPortalOverlay,
  shake,
  onPortal,
}: {
  showPortalOverlay: boolean;
  shake: Shake;
  onPortal: () => void;
}) {
  return (
    <Button
      variant="primary"
      disabled={showPortalOverlay}
      className={shake.portal.className}
      onAnimationEnd={shake.portal.end}
      onClick={onPortal}
    >
      <BusyContent busy={showPortalOverlay}>Manage subscription</BusyContent>
    </Button>
  );
}

/** A paid plan with no billing account. The portal cannot open for them, so
 * offer the truth instead of a button that errors (#85). Which truth depends
 * on how they got the plan: comped, or a subscription that arrived without a
 * customer id. Thanking the second group for a gift nobody gave them would be
 * false (#81). */
function NoBillingAccountNote({ plan, comped }: { plan: OrgPlan; comped: boolean }) {
  return (
    <p className="text-sm text-muted">
      {comped
        ? // Not "nothing to pay": the comp is what grants the plan, and it
          // says nothing about whether a subscription is still charging
          // somewhere. Only support can see both and answer that.
          `You have ${PLAN_LABEL[plan]} for free, with our thanks. There is no billing account linked, so the subscription portal cannot open. Email support if you want anything changed.`
        : "No billing account is linked to this plan, so the subscription portal cannot open. Email support and we will link it."}
    </p>
  );
}

/** The one control the plan card offers: upgrade buttons on free, the portal
 * button on a paid plan that has an account, and an explanation when it does
 * not. */
function PlanActionControl({
  snapshot,
  commands,
}: {
  snapshot: PlanActionSnapshot;
  commands: PlanActionCommands;
}) {
  if (snapshot.plan === "free")
    return (
      <FreeUpgradeButtons
        checkoutPlan={snapshot.checkoutPlan}
        shake={commands.shake}
        onUpgrade={commands.onUpgrade}
      />
    );
  if (!snapshot.hasBillingAccount)
    return <NoBillingAccountNote plan={snapshot.plan} comped={snapshot.comped} />;
  return (
    <ManageSubscriptionButton
      showPortalOverlay={snapshot.showPortalOverlay}
      shake={commands.shake}
      onPortal={commands.onPortal}
    />
  );
}

function PlanComparison({ plan }: { plan: OrgPlan }) {
  return plan === "free" ? <PlanFeatureComparison /> : null;
}

function HobbyUpgradeHint({ snapshot }: { snapshot: PlanActionSnapshot }) {
  if (snapshot.plan !== "hobby" || !snapshot.hasBillingAccount || snapshot.comped) return null;
  return (
    <p className="mt-2 text-xs text-muted">Want Pro? Switch plans from the subscription portal.</p>
  );
}

function PlanActions({
  snapshot,
  commands,
}: {
  snapshot: PlanActionSnapshot;
  commands: PlanActionCommands;
}) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted">Plan</p>
          <Badge color={snapshot.plan === "free" ? "muted" : "mint"}>
            {PLAN_LABEL[snapshot.plan]}
          </Badge>
        </div>
        <p className="text-sm text-muted">
          Billing is per account: your plan applies to every organization you own.
        </p>
        <PlanStatusNotes
          plan={snapshot.plan}
          comped={snapshot.comped}
          cancelAtPeriodEnd={snapshot.cancelAtPeriodEnd}
          periodEnd={snapshot.periodEnd}
          confirmTimedOut={snapshot.confirmTimedOut}
        />
        <PlanComparison plan={snapshot.plan} />
        <div>
          <PlanActionControl snapshot={snapshot} commands={commands} />
          {/* Not for a comped Hobby: the portal changes the subscription, and
              the comp would still outrank whatever it changed to. */}
          <HobbyUpgradeHint snapshot={snapshot} />
        </div>
      </div>
    </Card>
  );
}

function UsageLine({ label, count, limit }: { label: string; count: number; limit: number }) {
  return (
    <p className="text-sm text-muted tnum">
      {label} {count} / {limit}
    </p>
  );
}

/**
 * The three lines the usage card is waiting on.
 *
 * Each bar sits in a box the height of the text it replaces (text-sm, a 20px
 * line) inside the same `gap-1` column as the real lines. Before, three 14px
 * bars in a `gap-3` column stood in for three 20px lines in a `gap-1` one, so
 * the card resized under the "Orgs you own" line that renders throughout.
 */
function UsageMeterSkeleton() {
  return (
    <>
      {[32, 36, 28].map((w) => (
        <span key={w} className="flex h-5 items-center">
          <Skeleton className="h-3.5" style={{ width: `${w * 0.25}rem` }} />
        </span>
      ))}
    </>
  );
}

function UsageRows({ snapshot, limits }: { snapshot: UsageSnapshot; limits: PlanLimits }) {
  if (snapshot.loading) return <UsageMeterSkeleton />;
  return (
    <>
      <UsageLine label="Links" count={snapshot.linkQuotaCount ?? 0} limit={limits.links} />
      <UsageLine label="Members" count={snapshot.memberCount} limit={limits.members} />
      <UsageLine label="Domains" count={snapshot.domainCount} limit={limits.domains} />
    </>
  );
}

function UsageMeter({ snapshot }: { snapshot: UsageSnapshot }) {
  if (!snapshot.org) return null;
  const limits = PLAN_LIMITS[snapshot.org.plan];
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-1">
        <p className="mb-2 text-xs font-medium text-muted">Usage: {snapshot.org.name}</p>
        <UsageRows snapshot={snapshot} limits={limits} />
        <UsageLine
          label="Orgs you own"
          count={snapshot.ownedOrgs}
          limit={PLAN_LIMITS[snapshot.plan].orgs}
        />
      </div>
    </Card>
  );
}

function BillingOverlay({ show, message }: { show: boolean; message: string }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <m.div
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
      <m.div
        className="relative z-10 flex flex-col items-center gap-4 rounded-xl bg-surface p-8 text-center smooth-shadow-ring-2xl"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
        <p className="font-bold">{message}</p>
      </m.div>
    </div>
  );
}

/**
 * The moment after checkout.
 *
 * Somebody who bought from a landing CTA gets here before they have made
 * anything: they signed up, paid, and are now looking at an invoice. So when
 * the account has no links, the overlay carries the next step instead of the
 * old claim that they "have access to all Pro features", which is not
 * something they can see until a link exists.
 */
function CelebrationOverlay({
  show,
  plan,
  onDismiss,
  onFirstLink,
}: {
  show: boolean;
  plan: OrgPlan;
  onDismiss: () => void;
  /** Set only while the account has no links: the first-run handoff. */
  onFirstLink?: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* The backdrop is the dismiss control, beside the card rather
              than wrapped around it. Wrapped, the card's own button sat
              inside a role="button" that answered Enter and Space too: a
              keyboard press on "Shorten your first link" closed the overlay
              on the way past, and stopping the click did nothing about the
              key. */}
          <button
            type="button"
            aria-label="Dismiss celebration"
            className="fixed inset-0 cursor-pointer bg-black/55 backdrop-blur-[2px]"
            onClick={onDismiss}
          />
          <m.div
            className="relative z-10 flex flex-col items-center gap-4 rounded-xl border border-accent/30 bg-surface p-10 text-center shadow-2xl"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <span className="text-5xl">🎉</span>
            <p className="text-xl font-bold text-accent">Welcome to {PLAN_LABEL[plan]}!</p>
            {onFirstLink ? (
              <Button variant="primary" onClick={onFirstLink}>
                Shorten your first link
              </Button>
            ) : (
              <p className="text-sm text-muted">
                You now have access to all {PLAN_LABEL[plan]} features.
              </p>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

const WEBHOOK_POLL_MS = 2000;
const WEBHOOK_POLL_TRIES = 5;

/**
 * Waits for a Polar webhook to land, by asking the server again.
 *
 * Polar sends the browser back before it delivers the webhook, so both
 * returns (from checkout and from the subscription portal) read the row as it
 * was. One refetch races the delivery, so keep asking while `waiting` until
 * `arrived`, then give up rather than poll forever.
 *
 * The callbacks live in a ref: they close over state setters that change
 * every render, and re-running the interval on each of those would reset the
 * try count and make "give up" unreachable.
 */
function useAwaitWebhook({
  waiting,
  arrived,
  onArrived,
  onGaveUp,
}: {
  waiting: boolean;
  arrived: boolean;
  onArrived: () => void;
  onGaveUp: () => void;
}) {
  const qc = useQueryClient();
  const callbacks = useRef({ onArrived, onGaveUp });
  useEffect(() => {
    callbacks.current = { onArrived, onGaveUp };
  });

  useEffect(() => {
    if (!waiting) return;
    if (arrived) {
      callbacks.current.onArrived();
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (tries > WEBHOOK_POLL_TRIES) {
        window.clearInterval(id);
        callbacks.current.onGaveUp();
        return;
      }
      void qc.refetchQueries({ queryKey: ["user"] });
    }, WEBHOOK_POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, arrived, qc]);
}

/** Confetti and the overlay that goes with it, for four seconds. */
function useCelebration() {
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrate = useCallback(() => {
    setShowCelebration(true);
    const colors = ["#cdb9f5", "#b9e6c9", "#f5b8c8", "#f2e3b3", "#b9d9f0"];
    for (const angle of [60, 120]) {
      confetti({
        particleCount: 40,
        angle,
        spread: 70,
        startVelocity: 50,
        origin: { x: angle === 60 ? 0 : 1, y: 0.75 },
        colors,
      });
    }
    setTimeout(() => setShowCelebration(false), 4000);
  }, []);
  return { showCelebration, setShowCelebration, celebrate };
}

/**
 * `?plan=hobby` (with an optional `&interval=year`) on the landing CTAs sends
 * someone straight to checkout, so a visitor who picked a plan before signing
 * up does not have to pick it twice.
 *
 * Once only, and only for a free account: re-running it would open checkout
 * again behind the person's back. The URL is cleaned either way, so a reload
 * is an ordinary visit to the billing page.
 */
function useAutoUpgradeFromUrl(
  user: { plan: OrgPlan } | undefined,
  onUpgrade: (target: "hobby" | "pro", interval: BillingInterval) => void,
) {
  const done = useRef(false);
  const upgrade = useRef(onUpgrade);
  useEffect(() => {
    upgrade.current = onUpgrade;
  });
  useEffect(() => {
    if (!user || done.current) return;
    done.current = true;
    const url = new URL(window.location.href);
    const target = url.searchParams.get("plan");
    const interval = url.searchParams.get("interval") === "year" ? "year" : "month";
    if (target !== "hobby" && target !== "pro") return;
    url.searchParams.delete("plan");
    url.searchParams.delete("interval");
    window.history.replaceState({}, "", url.toString());
    if (user.plan === "free") upgrade.current(target, interval);
  }, [user]);
}

function useCheckoutFlow() {
  const currentUser = useCurrentUser();
  const checkout = useCheckout();
  const portal = usePortal();
  const confirmCheckout = useConfirmCheckout();
  const toast = useToast();
  // One handle per button, kept here because the mutation error handlers
  // below are what call `start()`. Grouped so the three travel as one prop,
  // and memoized so the group changes only when a button actually shakes.
  const shakeHobby = useShake();
  const shakePro = useShake();
  const shakePortal = useShake();
  const shake = useMemo(
    () => ({ hobby: shakeHobby, pro: shakePro, portal: shakePortal }),
    [shakeHobby, shakePro, shakePortal],
  );
  const qc = useQueryClient();

  const [checkoutPlan, setCheckoutPlan] = useState<"hobby" | "pro" | null>(null);
  const [showPortalOverlay, setShowPortalOverlay] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);
  // The checkout id from the return URL, kept around so onGaveUp below can
  // ask Polar about this exact checkout if the webhook never shows up.
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  // The billing state as it was before a trip to the portal, while we wait
  // for the webhook to move it. Null when we are not waiting.
  const [portalSnapshot, setPortalSnapshot] = useState<string | null>(null);
  const { showCelebration, setShowCelebration, celebrate } = useCelebration();

  const handleUpgrade = async (target: "hobby" | "pro", interval: BillingInterval = "month") => {
    posthog.capture("checkout_started", { target_plan: target, interval });
    setCheckoutPlan(target);
    try {
      const data = await checkout.mutateAsync({ plan: target, interval });
      setTimeout(() => window.location.assign(data.url), 300);
    } catch (e) {
      setCheckoutPlan(null);
      shake[target].start();
      toast(errorMessage(e), "error");
    }
  };

  const handlePortal = async () => {
    posthog.capture("subscription_portal_opened");
    setShowPortalOverlay(true);
    try {
      const data = await portal.mutateAsync();
      // Remembered across the trip to Polar, so the return can tell whether
      // the webhook has landed yet. sessionStorage because the browser back
      // button is the only way back and nothing survives that in memory.
      sessionStorage.setItem(
        PORTAL_SNAPSHOT_KEY,
        billingSnapshot(portalState(currentUser.data?.user)),
      );
      setTimeout(() => window.location.assign(data.url), 800);
    } catch (e) {
      setShowPortalOverlay(false);
      shake.portal.start();
      toast(errorMessage(e), "error");
    }
  };

  // Reset overlay state when returning from Polar via bfcache (browser back).
  useEffect(() => {
    const handler = () => {
      setCheckoutPlan(null);
      setShowPortalOverlay(false);
      setConfirming(false);
      setConfirmTimedOut(false);
      setCheckoutId(null);
      setShowCelebration(false);
      // The portal is where a plan changes, a cancel is scheduled, and a
      // cancel is undone, and none of the three sends the browser back here
      // with anything in the URL to notice. Without this the page restores
      // from bfcache and shows the state from before the visit, because
      // refetchOnWindowFocus is off for every query (src/app/main.tsx).
      void qc.refetchQueries({ queryKey: ["user"] });
      const before = sessionStorage.getItem(PORTAL_SNAPSHOT_KEY);
      if (before !== null) {
        sessionStorage.removeItem(PORTAL_SNAPSHOT_KEY);
        setPortalSnapshot(before);
      }
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
    // setShowCelebration now arrives from useCelebration rather than a
    // useState in this scope. It is still the same stable setter, so listing
    // it costs nothing and keeps the dependency honest.
  }, [qc, setShowCelebration]);

  const plan = currentUser.data?.user.plan ?? "free";
  const snapshot = billingSnapshot(portalState(currentUser.data?.user));

  /**
   * The portal return. Silent, with no overlay: unlike the checkout return,
   * we do not know that anything changed in the portal, and most visits
   * change nothing. A visit that really changed nothing polls quietly and
   * gives up.
   */
  useAwaitWebhook({
    waiting: portalSnapshot !== null,
    arrived: snapshot !== portalSnapshot,
    onArrived: () => setPortalSnapshot(null),
    onGaveUp: () => setPortalSnapshot(null),
  });

  // Detect the checkout return once on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("checkout_id");
    if (id) {
      setCheckoutPlan(null);
      setShowPortalOverlay(false);
      setConfirming(true);
      setCheckoutId(id);
      url.searchParams.delete("checkout_id");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // The checkout return: the plan flipping to paid is the webhook landing.
  // If it hasn't landed by the time the poll gives up, ask Polar directly
  // rather than leaving someone who already paid looking free on reload
  // (see POST /billing/checkout/:id/confirm on the worker).
  useAwaitWebhook({
    waiting: confirming,
    arrived: plan !== "free",
    onArrived: () => {
      setConfirming(false);
      celebrate();
    },
    onGaveUp: async () => {
      const confirmed = checkoutId
        ? await confirmCheckout.mutateAsync(checkoutId).catch(() => null)
        : null;
      setConfirming(false);
      if (confirmed && confirmed.plan !== "free") {
        await qc.refetchQueries({ queryKey: ["user"] });
        celebrate();
        return;
      }
      setConfirmTimedOut(true);
    },
  });

  useAutoUpgradeFromUrl(
    currentUser.data?.user,
    (target, interval) => void handleUpgrade(target, interval),
  );

  return {
    plan,
    checkoutPlan,
    showPortalOverlay,
    showCelebration,
    confirming,
    confirmTimedOut,
    setShowCelebration,
    handleUpgrade,
    handlePortal,
    shake,
  };
}

/** How many orgs the user owns (vs. member/admin of), for the "Orgs you
 * own / plan limit" usage line. */
function ownedOrgCount(orgs: { role: string }[] | undefined): number {
  return orgs?.filter((o) => o.role === "owner").length ?? 0;
}

/** The full-page loading overlay's visibility and message: shown for an
 * in-flight checkout/portal redirect, or while confirming a completed one. */
function billingOverlayState(
  checkoutPlan: "hobby" | "pro" | null,
  showPortalOverlay: boolean,
  confirming: boolean,
) {
  return {
    show: checkoutPlan !== null || showPortalOverlay || confirming,
    message: confirming ? "Confirming your upgrade…" : "Redirecting to Polar…",
  };
}

/**
 * The account fields this page reads, with their defaults applied once.
 *
 * Every one of them is optional on the user, and defaulting each at the point
 * of use turned the page into a list of `?? false`.
 */
const NO_ACCOUNT_YET = {
  hasBillingAccount: false,
  comped: false,
  polarSubscriptionCancelAtPeriodEnd: false,
  polarSubscriptionCurrentPeriodEnd: null,
};

function useBillingAccount() {
  const currentUser = useCurrentUser();
  // One default for the whole shape, not one per field: every one of these
  // is required on User, so the only question is whether the user query has
  // answered yet.
  const { hasBillingAccount, comped, ...subscription } = currentUser.data?.user ?? NO_ACCOUNT_YET;
  return {
    isLoading: currentUser.isLoading,
    hasBillingAccount,
    comped,
    cancelAtPeriodEnd: subscription.polarSubscriptionCancelAtPeriodEnd,
    periodEnd: subscription.polarSubscriptionCurrentPeriodEnd,
    ownedOrgs: ownedOrgCount(currentUser.data?.orgs),
  };
}

function itemCount(items: readonly unknown[] | undefined): number {
  return items?.length ?? 0;
}

function quotaCount(quota: { count: number } | undefined): number | undefined {
  return quota?.count;
}

function useBillingUsageSnapshot(plan: OrgPlan, ownedOrgs: number): UsageSnapshot {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const { data: linkQuota, isPending: linksPending } = useLinkQuotaUsage(orgId);
  const { data: memberData, isPending: membersPending } = useMembers(orgId);
  const { data: domainData, isPending: domainsPending } = useDomains(orgId);
  return {
    plan,
    org,
    linkQuotaCount: quotaCount(linkQuota),
    memberCount: itemCount(memberData),
    domainCount: itemCount(domainData),
    ownedOrgs,
    loading: [linksPending, membersPending, domainsPending].includes(true),
  };
}

function firstLinkAction(
  usage: UsageSnapshot,
  dismiss: () => void,
  navigate: ReturnType<typeof useNavigate>,
): (() => void) | undefined {
  if (!shouldOfferFirstLink(usage.org, usage.linkQuotaCount)) return undefined;
  return () => {
    dismiss();
    navigate({ to: "/dashboard" });
  };
}

function useBillingPageModel() {
  const account = useBillingAccount();
  const flow = useCheckoutFlow();
  const usage = useBillingUsageSnapshot(flow.plan, account.ownedOrgs);
  const navigate = useNavigate();
  const dismissCelebration = () => flow.setShowCelebration(false);

  return {
    loading: account.isLoading,
    planActions: {
      snapshot: {
        plan: flow.plan,
        hasBillingAccount: account.hasBillingAccount,
        comped: account.comped,
        checkoutPlan: flow.checkoutPlan,
        showPortalOverlay: flow.showPortalOverlay,
        confirmTimedOut: flow.confirmTimedOut,
        cancelAtPeriodEnd: account.cancelAtPeriodEnd,
        periodEnd: account.periodEnd,
      },
      commands: {
        shake: flow.shake,
        onUpgrade: flow.handleUpgrade,
        onPortal: flow.handlePortal,
      },
    },
    usage,
    overlay: billingOverlayState(flow.checkoutPlan, flow.showPortalOverlay, flow.confirming),
    celebration: {
      show: flow.showCelebration,
      plan: flow.plan,
      onDismiss: dismissCelebration,
      onFirstLink: firstLinkAction(usage, dismissCelebration, navigate),
    },
  };
}

export function BillingPage() {
  const model = useBillingPageModel();

  // The shell cache is deliberately not an authority for plan or billing
  // state. Rendering its free defaults here made the paid page flash first.
  if (model.loading) return <BillingSkeleton />;

  return (
    <div>
      <PageHeader title="Billing" sub="Your subscription" />
      <div className="flex flex-col gap-4">
        <PlanActions {...model.planActions} />
        <UsageMeter snapshot={model.usage} />
      </div>

      <LazyMotion features={domAnimation}>
        <BillingOverlay {...model.overlay} />
        {/* No org means no quota query, so the count never arrives: an account
            that checked out from a landing CTA before it had an organization
            is exactly the one this hand-off is for. */}
        <CelebrationOverlay {...model.celebration} />
      </LazyMotion>
    </div>
  );
}
