import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NotFound } from "./not-found";
import { errorMessage } from "@/app/lib/error-message";
import confetti from "canvas-confetti";
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCurrentUser,
  useLinkQuotaUsage,
  useClickUsage,
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
  type ClickUsage,
  type OrgPlan,
  type PlanLimits,
} from "@/shared/types";
import {
  clickUsageLevel,
  exactCount,
  nearSentence,
  reachedSentence,
  resetDay,
} from "@/shared/click-usage";
import { Check } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { PageHeader } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
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
  interval: "month" | "year" | null;
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
  clickUsage: ClickUsage | undefined;
  memberCount: number;
  domainCount: number;
  ownedOrgs: number;
  loading: boolean;
};

type PortalState = {
  plan: OrgPlan;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
  interval: "month" | "year" | null;
};

const PORTAL_SNAPSHOT_KEY = "billing:portal-snapshot";

/** Everything the subscription portal can change, as one comparable string:
 * the plan, whether a cancel is scheduled, and when the period ends. Enough
 * to tell "the webhook has landed" from "it has not landed yet". */
function portalState(user?: {
  plan: OrgPlan;
  polarSubscriptionCancelAtPeriodEnd: boolean;
  polarSubscriptionCurrentPeriodEnd: number | null;
  polarSubscriptionInterval: "month" | "year" | null;
}): PortalState {
  if (!user) return { plan: "free", cancelAtPeriodEnd: false, periodEnd: null, interval: null };
  return {
    plan: user.plan,
    cancelAtPeriodEnd: user.polarSubscriptionCancelAtPeriodEnd,
    periodEnd: user.polarSubscriptionCurrentPeriodEnd,
    interval: user.polarSubscriptionInterval,
  };
}

function billingSnapshot(state: PortalState) {
  // JSON, not join: a join renders null as an empty string, so "no period
  // end" and "period end of ''" would compare equal and the wait would end
  // on a change that never happened.
  return JSON.stringify([state.plan, state.cancelAtPeriodEnd, state.periodEnd, state.interval]);
}

const PLAN_LABEL = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "Unlimited (Self-hosted instance)",
} satisfies Record<OrgPlan, string>;

/** The plans anybody can pick, in order, so "up" and "down" mean something. */
const PLAN_ORDER = ["free", "hobby", "pro"] as const;
type SellablePlan = (typeof PLAN_ORDER)[number];

/** What a plan gets, as the short lines its card lists. Read off PLAN_LIMITS,
 * so the card can never promise more than the caps allow. */
function planFeatures(plan: SellablePlan): string[] {
  const limits = PLAN_LIMITS[plan];
  return [
    `${exactCount(limits.links)} links`,
    `${limits.members} members`,
    ...(limits.domains === 0
      ? []
      : [limits.domains === 1 ? "1 custom domain" : `${limits.domains} custom domains`]),
    ...(limits.orgs > 1 ? [`${limits.orgs} organizations`] : []),
    `${limits.analyticsDays} days of analytics`,
    `${exactCount(limits.trackedClicks)} clicks counted a month`,
    ...(limits.qrCustom ? ["QR logo and colors"] : []),
  ];
}

function planPrice(plan: SellablePlan, interval: BillingInterval): string {
  if (plan === "free") return "$0";
  return interval === "year" ? PLAN_PRICES_YEARLY[plan] : PLAN_PRICES[plan];
}

const INTERVAL_ITEMS = [
  { id: "month", label: "Monthly" },
  { id: "year", label: `Yearly, ${YEARLY_DISCOUNT_LABEL.toLowerCase()}` },
] as const satisfies readonly { id: BillingInterval; label: string }[];

function IntervalSwitch({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (next: BillingInterval) => void;
}) {
  return (
    <Segmented label="Billing cycle" items={INTERVAL_ITEMS} value={interval} onChange={onChange} />
  );
}

/** One plan, side by side with the others: its price at the chosen cycle,
 * what it gets, and the one button that moves to it. */
function PlanCard({
  plan,
  current,
  interval,
  action,
}: {
  plan: SellablePlan;
  current: boolean;
  interval: BillingInterval;
  action: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-surface p-4",
        current
          ? "shadow-[0_0_0_1.5px_var(--accent),0_1px_2px_rgb(0_0_0/0.06)]"
          : "smooth-shadow-ring-xs",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{PLAN_LABEL[plan]}</h3>
        {current && <span className="text-xs text-muted">Your plan</span>}
      </div>
      <p className="tnum">
        <span className="text-xl font-semibold">{planPrice(plan, interval)}</span>{" "}
        <span className="text-sm text-muted">
          {plan !== "free" && interval === "year" ? "a month, billed yearly" : "a month"}
        </span>
      </p>
      <ul className="flex flex-col gap-1.5 text-sm tnum">
        {planFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <Check size={14} aria-hidden="true" className="shrink-0 text-accent-2" />
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-1 [&>button]:w-full">{action}</div>
    </div>
  );
}

function CurrentPlanButton() {
  return (
    <Button variant="outline" disabled>
      Current plan
    </Button>
  );
}

/** Free: the three plans, with checkout one click away. Pro is the one
 * primary button on the screen. */
function FreePlans({
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
  const upgradeButton = (target: "hobby" | "pro") => (
    <Button
      variant={target === "pro" ? "primary" : "outline"}
      disabled={busy}
      className={shake[target].className}
      onAnimationEnd={shake[target].end}
      onClick={() => onUpgrade(target, interval)}
    >
      <BusyContent busy={checkoutPlan === target}>
        Upgrade to {PLAN_LABEL[target]} · {priceSuffix(target, interval)}
      </BusyContent>
    </Button>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-medium text-muted">Plans</h2>
          <p className="text-xs text-muted">Covers every organization you own.</p>
        </div>
        <IntervalSwitch interval={interval} onChange={setInterval} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <PlanCard plan="free" current interval={interval} action={<CurrentPlanButton />} />
        <PlanCard
          plan="hobby"
          current={false}
          interval={interval}
          action={upgradeButton("hobby")}
        />
        <PlanCard plan="pro" current={false} interval={interval} action={upgradeButton("pro")} />
      </div>
    </section>
  );
}

/**
 * A subscriber's plans, behind "Change plan". A plan changes in the
 * subscription portal, never through a second checkout (that would be a second
 * subscription), so every button here opens the portal. The cycle switch only
 * shows the prices; the portal is where the cycle changes too.
 */
function ChangePlanDialog({
  open,
  onOpenChange,
  snapshot,
  onPortal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: PlanActionSnapshot;
  onPortal: () => void;
}) {
  const [interval, setInterval] = useState<BillingInterval>(snapshot.interval ?? "month");
  const currentRank = PLAN_ORDER.findIndex((plan) => plan === snapshot.plan);
  const moveTo = (plan: SellablePlan) => {
    const up = PLAN_ORDER.indexOf(plan) > currentRank;
    return (
      <Button
        variant={up && plan === "pro" ? "primary" : "outline"}
        onClick={() => {
          onOpenChange(false);
          onPortal();
        }}
      >
        {up ? "Upgrade" : "Switch"} to {PLAN_LABEL[plan]}
      </Button>
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change plan" wide>
      <div className="flex flex-col gap-4">
        <IntervalSwitch interval={interval} onChange={setInterval} />
        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_ORDER.map((plan) => (
            <PlanCard
              key={plan}
              plan={plan}
              current={plan === snapshot.plan}
              interval={interval}
              action={plan === snapshot.plan ? <CurrentPlanButton /> : moveTo(plan)}
            />
          ))}
        </div>
        <p className="text-xs text-pretty text-muted">
          Plan changes open in the subscription portal. Switching down deletes nothing.
        </p>
      </div>
    </Dialog>
  );
}

/** The cancel-scheduled and still-confirming status notes; either, both, or
 * neither can show depending on account state. */
function CancelScheduledNotice({ plan, periodEnd }: { plan: OrgPlan; periodEnd: number }) {
  return (
    // Ink, not a caution colour: the sentence carries the warning, and
    // --butter is under AA as text on cream.
    <p className="text-sm text-text">
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
 *
 * Renders no wrapper of its own, so each note is a direct child of whatever
 * holds it: a row in the plan card, or an item in the page column.
 */
function PlanStatusNotes({
  snapshot,
  inset,
}: {
  snapshot: PlanActionSnapshot;
  /** Pad each note as a row of the card it sits in. */
  inset?: boolean;
}) {
  const reduced = useReducedMotion();
  const grow = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" as const },
        exit: { opacity: 0, height: 0 },
      };
  const pad = inset ? "px-4 py-3" : "";
  const { plan, comped, cancelAtPeriodEnd, periodEnd, confirmTimedOut } = snapshot;
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {showsCancelNotice(cancelAtPeriodEnd, periodEnd, comped) && (
          <m.div key="cancel" {...grow} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className={pad}>
              <CancelScheduledNotice plan={plan} periodEnd={periodEnd} />
            </div>
          </m.div>
        )}
        {showsConfirmingNotice(confirmTimedOut, plan) && (
          <m.div
            key="confirming"
            {...grow}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={pad}>
              <ConfirmingPaymentNotice />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

/** A paid plan with no billing account. The portal cannot open for them, so
 * offer the truth instead of a button that errors (#85). Which truth depends
 * on how they got the plan: comped, or a subscription that arrived without a
 * customer id. Thanking the second group for a gift nobody gave them would be
 * false (#81). */
function NoBillingAccountNote({ plan, comped }: { plan: OrgPlan; comped: boolean }) {
  return (
    <p className="px-4 py-3 text-sm text-pretty text-muted">
      {comped
        ? // Not "nothing to pay": the comp is what grants the plan, and it
          // says nothing about whether a subscription is still charging
          // somewhere. Only support can see both and answer that.
          `You have ${PLAN_LABEL[plan]} for free, with our thanks. There is no billing account linked, so the subscription portal cannot open. Email support if you want anything changed.`
        : "No billing account is linked to this plan, so the subscription portal cannot open. Email support and we will link it."}
    </p>
  );
}

const PLAN_CHANGE_HINT = "Switch between monthly and yearly, update your card, or cancel.";

const INTERVAL_LABEL = { month: "Monthly", year: "Yearly" } as const;

/** The plan's name: "Pro · Yearly" for a subscriber, just the plan for comped. */
function planTitle({ plan, comped, interval }: PlanActionSnapshot): string {
  const cycle = comped || !interval ? "" : ` · ${INTERVAL_LABEL[interval]}`;
  return PLAN_LABEL[plan] + cycle;
}

/** "Renews Nov 14" while a subscription runs on. A scheduled cancel says its
 * own date in the note below, and a comp renews nothing. */
function renewalLine(snapshot: PlanActionSnapshot): string | null {
  if (!snapshot.hasBillingAccount || snapshot.comped || snapshot.cancelAtPeriodEnd) return null;
  return snapshot.periodEnd == null ? null : `Renews ${shortDate(snapshot.periodEnd)}`;
}

/** Whether "Change plan" can do anything: only a subscription the portal can
 * change. Not for a comp, which would still outrank whatever it changed to. */
function canChangePlan(snapshot: PlanActionSnapshot): boolean {
  return snapshot.hasBillingAccount && !snapshot.comped;
}

/** A paid plan: what it is, when it renews, and the way to change it. */
function PaidPlan({
  snapshot,
  onChangePlan,
}: {
  snapshot: PlanActionSnapshot;
  onChangePlan: () => void;
}) {
  const renewal = renewalLine(snapshot);
  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold">{planTitle(snapshot)}</span>
            {renewal && <span className="text-sm text-muted tnum">{renewal}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">Covers every organization you own.</p>
        </div>
        {canChangePlan(snapshot) && (
          <Button variant="outline" onClick={onChangePlan}>
            Change plan
          </Button>
        )}
      </div>
      <PlanStatusNotes snapshot={snapshot} inset />
      {!snapshot.hasBillingAccount && (
        <NoBillingAccountNote plan={snapshot.plan} comped={snapshot.comped} />
      )}
    </SettingsGroup>
  );
}

/** Card, invoices and cancelling all live in Polar's portal. */
function PaymentGroup({
  snapshot,
  commands,
}: {
  snapshot: PlanActionSnapshot;
  commands: PlanActionCommands;
}) {
  if (!snapshot.hasBillingAccount) return null;
  return (
    <SettingsGroup title="Payment">
      <SettingsRow label="Subscription" hint={snapshot.comped ? undefined : PLAN_CHANGE_HINT}>
        <Button
          variant="outline"
          disabled={snapshot.showPortalOverlay}
          className={commands.shake.portal.className}
          onAnimationEnd={commands.shake.portal.end}
          onClick={commands.onPortal}
        >
          <BusyContent busy={snapshot.showPortalOverlay}>Manage subscription</BusyContent>
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

/** One figure against its cap: "184 of 3,000" over a thin bar. Over the cap,
 * the figure and the bar turn to the danger colour; the figure already says
 * by how much. */
function UsageRow({
  label,
  hint,
  count,
  limit,
  children,
}: {
  label: string;
  hint?: string;
  count: number;
  limit: number;
  children?: ReactNode;
}) {
  const over = count > limit;
  const share = limit > 0 ? Math.min(1, count / limit) : 1;
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[13rem_1fr_9rem]">
        <p className="text-sm">
          {label}
          {hint && <span className="text-xs text-muted"> · {hint}</span>}
        </p>
        <div
          aria-hidden="true"
          className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-surface-2 sm:col-span-1 sm:row-start-auto"
        >
          <div
            className={cn("h-full rounded-full", over ? "bg-danger" : "bg-accent")}
            style={{ width: `${Math.max(2, share * 100)}%` }}
          />
        </div>
        <p className="text-right text-sm tnum">
          <span className={cn("font-semibold", over && "text-danger")}>{exactCount(count)}</span>{" "}
          <span className="text-muted">of {exactCount(limit)}</span>
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * This month's tracked clicks (#387), and from 80% on, what happens at the
 * cap. The links keep working either way, and the line says so before it
 * says anything else.
 */
function ClickUsageRow({ usage }: { usage: ClickUsage }) {
  const level = clickUsageLevel(usage.clicks, usage.limit);
  const now = Date.now();
  return (
    <UsageRow
      label="Clicks counted this month"
      hint={`resets ${resetDay(now)}`}
      count={usage.clicks}
      limit={usage.limit}
    >
      {level !== "under" && (
        <p className="mt-2 max-w-prose text-sm text-pretty">
          {level === "reached" && <span className="font-semibold">Limit reached. </span>}
          {level === "reached" ? reachedSentence(usage.limit, now) : nearSentence(usage.limit, now)}
        </p>
      )}
    </UsageRow>
  );
}

/** The rows the usage card is waiting on, each the height of the row it
 * stands in for, so nothing moves when the figures arrive. */
function UsageRowsSkeleton() {
  return (
    <>
      {[24, 28, 20, 40].map((w) => (
        <div key={w} className="flex h-11 items-center px-4">
          <Skeleton className="h-3.5" style={{ width: `${w * 0.25}rem` }} />
        </div>
      ))}
    </>
  );
}

function UsageRows({ snapshot, limits }: { snapshot: UsageSnapshot; limits: PlanLimits }) {
  if (snapshot.loading) return <UsageRowsSkeleton />;
  return (
    <>
      <UsageRow label="Links" count={snapshot.linkQuotaCount ?? 0} limit={limits.links} />
      <UsageRow label="Members" count={snapshot.memberCount} limit={limits.members} />
      {/* Free has no custom domains: "0 of 0" says nothing. */}
      {(limits.domains > 0 || snapshot.domainCount > 0) && (
        <UsageRow label="Custom domains" count={snapshot.domainCount} limit={limits.domains} />
      )}
      {snapshot.clickUsage && <ClickUsageRow usage={snapshot.clickUsage} />}
    </>
  );
}

function UsageGroup({ snapshot }: { snapshot: UsageSnapshot }) {
  if (!snapshot.org) return null;
  const limits = PLAN_LIMITS[snapshot.org.plan];
  return (
    <SettingsGroup title="Usage" hint={snapshot.org.name}>
      <UsageRows snapshot={snapshot} limits={limits} />
      <UsageRow
        label="Organizations you own"
        count={snapshot.ownedOrgs}
        limit={PLAN_LIMITS[snapshot.plan].orgs}
      />
    </SettingsGroup>
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
        role="status"
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
            <span aria-hidden="true" className="text-5xl">
              🎉
            </span>
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
        // The overlay still says it; the burst is the part that moves.
        disableForReducedMotion: true,
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
    upgradeIfFree(user.plan, takeUpgradeRequest(), upgrade.current);
  }, [user]);
}

function upgradeIfFree(
  plan: OrgPlan,
  request: ReturnType<typeof takeUpgradeRequest>,
  onUpgrade: (target: "hobby" | "pro", interval: BillingInterval) => void,
) {
  if (request && plan === "free") onUpgrade(request.target, request.interval);
}

/** The plan and cycle a landing CTA asked for, read off the URL and then
 * removed from it, so a reload is an ordinary visit. Null when the URL asks
 * for nothing. */
function takeUpgradeRequest(): { target: "hobby" | "pro"; interval: BillingInterval } | null {
  const url = new URL(window.location.href);
  const target = url.searchParams.get("plan");
  const interval = url.searchParams.get("interval") === "year" ? "year" : "month";
  if (target !== "hobby" && target !== "pro") return null;
  url.searchParams.delete("plan");
  url.searchParams.delete("interval");
  window.history.replaceState({}, "", url.toString());
  return { target, interval };
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
  polarSubscriptionInterval: null,
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
    interval: subscription.polarSubscriptionInterval,
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
  const { data: clickUsage, isPending: clicksPending } = useClickUsage(orgId);
  return {
    plan,
    org,
    linkQuotaCount: quotaCount(linkQuota),
    clickUsage,
    memberCount: itemCount(memberData),
    domainCount: itemCount(domainData),
    ownedOrgs,
    loading: [linksPending, membersPending, domainsPending, clicksPending].includes(true),
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
        interval: account.interval,
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
  const { data: current } = useCurrentUser();
  const [changingPlan, setChangingPlan] = useState(false);
  // A self-hosted instance sells nothing.
  if (current?.user.plan === "unlimited") return <NotFound />;

  // The shell cache is deliberately not an authority for plan or billing
  // state. Rendering its free defaults here made the paid page flash first.
  // The fresh /user answer may land before the rest: it only picks the
  // skeleton's shape, never what the page says.
  if (model.loading) return <BillingSkeleton plan={current?.user.plan} />;

  const { snapshot, commands } = model.planActions;
  const free = snapshot.plan === "free";

  return (
    <div>
      <PageHeader
        title="Billing"
        sub={free ? "You’re on Free. Upgrade any time, cancel any time." : undefined}
      />
      <div className="flex max-w-[760px] flex-col gap-8">
        {free ? (
          <>
            <PlanStatusNotes snapshot={snapshot} />
            <UsageGroup snapshot={model.usage} />
            <FreePlans
              checkoutPlan={snapshot.checkoutPlan}
              shake={commands.shake}
              onUpgrade={commands.onUpgrade}
            />
          </>
        ) : (
          <>
            <PaidPlan snapshot={snapshot} onChangePlan={() => setChangingPlan(true)} />
            <UsageGroup snapshot={model.usage} />
            <PaymentGroup snapshot={snapshot} commands={commands} />
            {canChangePlan(snapshot) && (
              <ChangePlanDialog
                open={changingPlan}
                onOpenChange={setChangingPlan}
                snapshot={snapshot}
                onPortal={commands.onPortal}
              />
            )}
          </>
        )}
      </div>

      <LazyMotion features={domAnimation}>
        <MotionConfig reducedMotion="user">
          <BillingOverlay {...model.overlay} />
          {/* No org means no quota query, so the count never arrives: an account
            that checked out from a landing CTA before it had an organization
            is exactly the one this hand-off is for. */}
          <CelebrationOverlay {...model.celebration} />
        </MotionConfig>
      </LazyMotion>
    </div>
  );
}
