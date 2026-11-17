import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAwaitWebhook } from "../lib/await-webhook";
import { settle } from "../lib/route-preload";
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
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  billingDetailsQuery,
  clickUsageQuery,
  domainsQuery,
  linkQuotaUsageQuery,
  membersQuery,
  useBillingDetails,
  useCurrentUser,
  useLinkQuotaUsage,
  useClickUsage,
  useMembers,
  useDomains,
  useCheckout,
  usePortal,
  useConfirmCheckout,
  userQuery,
} from "../lib/hooks";
import { shortDate } from "../lib/dates";
import { useCurrentOrg } from "../lib/current-org";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_PRICES_YEARLY,
  YEARLY_DISCOUNT_LABEL,
  type AccountTier,
  type BillingDetails,
  type ClickUsage,
  type Invoice,
  type PaymentCard,
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
import { Check, Download } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog, DialogClose, DialogTitle } from "../ui/dialog";
import { PageHeader } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
import { EnterpriseNote } from "../components/enterprise-note";
import { RDYRCT_SITE } from "@/shared/site";
import { SUPPORT_EMAIL } from "@/shared/support";
import { BusyContent } from "../ui/spinner";
import { Skeleton } from "../ui/skeleton";
import { BillingSkeleton } from "../components/skeletons";
import { useShake } from "../lib/use-shake";
import { showsCancelNotice, showsConfirmingNotice } from "../lib/plan-status-notes";
import { useToast } from "../ui/toast";
import posthog from "../lib/posthog";
import { useSavePendingQrStyle } from "../lib/pending-qr-style";
import { shouldOfferFirstLink } from "../lib/billing-page";
import { Tooltip } from "@/app/ui/tooltip";

type Shake = Record<"hobby" | "pro" | "portal", ReturnType<typeof useShake>>;

type BillingInterval = "month" | "year";

type PlanActionSnapshot = {
  plan: OrgPlan;
  tier: AccountTier;
  limits: PlanLimits;
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
  org: { id: string; name: string; plan: OrgPlan; limits: PlanLimits } | null;
  linkQuotaCount: number | undefined;
  clickUsage: ClickUsage | undefined;
  memberCount: number;
  domainCount: number;
  ownedOrgs: number;
  ownedOrgLimit: number;
  loading: boolean;
};

type PortalState = {
  plan: OrgPlan;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
  interval: "month" | "year" | null;
};

const PORTAL_SNAPSHOT_KEY = "billing:portal-snapshot";

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
  // JSON, not join: a join renders null as "", so "no period end" and "" compare equal and the wait would end on a change that never happened.
  return JSON.stringify([state.plan, state.cancelAtPeriodEnd, state.periodEnd, state.interval]);
}

const PLAN_LABEL = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "Unlimited (Self-hosted instance)",
} satisfies Record<OrgPlan, string>;

const PLAN_ORDER = ["free", "hobby", "pro"] as const;
type SellablePlan = (typeof PLAN_ORDER)[number];

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
    `${exactCount(limits.trackedClicks)} clicks a month`,
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
      <BusyContent busy={checkoutPlan === target}>Upgrade to {PLAN_LABEL[target]}</BusyContent>
    </Button>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-medium text-muted">Plans</h2>
          <p className="text-xs text-muted">Each plan covers one organization.</p>
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

/** A plan changes in the subscription portal, never through a second checkout (that would be a second subscription). */
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
  const currentInterval = snapshot.interval ?? "month";
  const [interval, setInterval] = useState<BillingInterval>(currentInterval);
  const currentRank = PLAN_ORDER.findIndex((plan) => plan === snapshot.plan);
  const toPortal = () => {
    onOpenChange(false);
    onPortal();
  };
  const moveTo = (plan: SellablePlan) => {
    const up = PLAN_ORDER.indexOf(plan) > currentRank;
    return (
      <Button variant={up && plan === "pro" ? "primary" : "outline"} onClick={toPortal}>
        {up ? "Upgrade" : "Switch"} to {PLAN_LABEL[plan]}
      </Button>
    );
  };
  // Yearly is its own Polar product, so moving to it is a plan change.
  const ownCard = () =>
    interval === currentInterval ? (
      <CurrentPlanButton />
    ) : (
      <Button variant="primary" onClick={toPortal}>
        Switch to {interval === "year" ? "yearly" : "monthly"}
      </Button>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change plan" size="xl" bare>
      <div className="flex flex-col gap-4 max-sm:px-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DialogTitle>Change plan</DialogTitle>
          <div className="flex items-center gap-3">
            <IntervalSwitch interval={interval} onChange={setInterval} />
            <DialogClose className="-mr-1.5" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_ORDER.map((plan) => (
            <PlanCard
              key={plan}
              plan={plan}
              current={plan === snapshot.plan}
              interval={interval}
              action={plan === snapshot.plan ? ownCard() : moveTo(plan)}
            />
          ))}
        </div>
        <p className="text-xs text-pretty text-muted">
          Switching down deletes nothing. Past the new plan's limits you can't add more until you
          make room, extra organizations go read-only, and extra domains stop after 30 days. Plan
          changes open in the subscription portal.
        </p>
      </div>
    </Dialog>
  );
}

function planName(snapshot: PlanActionSnapshot): string {
  return snapshot.tier === "enterprise" ? "Enterprise" : PLAN_LABEL[snapshot.plan];
}

function CancelScheduledNotice({ name, periodEnd }: { name: string; periodEnd: number }) {
  return (
    // Ink, not a caution colour: --butter is under AA as text on cream.
    <p className="text-sm text-text">
      Your {name} plan is scheduled to cancel on {shortDate(periodEnd)}. Paid features remain
      available until then.
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

function PlanStatusNotes({ snapshot, inset }: { snapshot: PlanActionSnapshot; inset?: boolean }) {
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
              <CancelScheduledNotice name={planName(snapshot)} periodEnd={periodEnd} />
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

/** No billing account, so the portal cannot open (#85). Thanking a subscription with no customer id for a gift would be false (#81). */
function NoBillingAccountNote({ name, comped }: { name: string; comped: boolean }) {
  return (
    <p className="px-4 py-3 text-sm text-pretty text-muted">
      {comped
        ? // Not "nothing to pay": a comp grants the plan and says nothing about a
          // subscription still charging. Only support can see both.
          `You have ${name} for free, with our thanks. There is no billing account linked, so the subscription portal cannot open. Email support if you want anything changed.`
        : "No billing account is linked to this plan, so the subscription portal cannot open. Email support and we will link it."}
    </p>
  );
}

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function renewalLine(snapshot: PlanActionSnapshot): string | null {
  // Enterprise is priced by hand: the plan's list price would be a wrong figure.
  if (!snapshot.hasBillingAccount || snapshot.comped || snapshot.tier === "enterprise") return null;
  if (snapshot.plan !== "hobby" && snapshot.plan !== "pro") return null;
  const price =
    snapshot.interval === "year"
      ? `${PLAN_PRICES_YEARLY[snapshot.plan]} a month, billed yearly`
      : `${PLAN_PRICES[snapshot.plan]} a month`;
  if (snapshot.cancelAtPeriodEnd || snapshot.periodEnd == null) return price;
  return `${price}, renews ${MONTH_DAY.format(new Date(snapshot.periodEnd))}`;
}

function canCancel(snapshot: PlanActionSnapshot): boolean {
  return canChangePlan(snapshot) && !snapshot.cancelAtPeriodEnd;
}

/** Not for a comp, which would still outrank whatever it changed to. */
function canChangePlan(snapshot: PlanActionSnapshot): boolean {
  return snapshot.hasBillingAccount && !snapshot.comped && snapshot.tier !== "enterprise";
}

function coversLine(ownedOrgLimit: number): string {
  return ownedOrgLimit > 1
    ? `Covers up to ${ownedOrgLimit} organizations you own.`
    : "Covers one organization.";
}

function PaidPlan({
  snapshot,
  usage,
  onChangePlan,
  onPortal,
}: {
  snapshot: PlanActionSnapshot;
  usage: UsageSnapshot;
  onChangePlan: () => void;
  onPortal: () => void;
}) {
  const renewal = renewalLine(snapshot);
  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold">{planName(snapshot)}</span>
            {renewal && <span className="text-sm text-muted tnum">{renewal}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">{coversLine(usage.ownedOrgLimit)}</p>
        </div>
        {canChangePlan(snapshot) && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onChangePlan}>
              Change plan
            </Button>
            {canCancel(snapshot) && (
              <Tooltip content="Cancels in the subscription portal. Paid features stay until the period ends.">
                <span className="inline-flex">
                  <Button variant="ghost" disabled={snapshot.showPortalOverlay} onClick={onPortal}>
                    Cancel
                  </Button>
                </span>
              </Tooltip>
            )}
          </div>
        )}
      </div>
      <PlanStatusNotes snapshot={snapshot} inset />
      {!snapshot.hasBillingAccount && (
        <NoBillingAccountNote name={planName(snapshot)} comped={snapshot.comped} />
      )}
      <UsageInPlan usage={usage} />
      {snapshot.tier === "enterprise" && <EnterpriseTerms limits={snapshot.limits} />}
    </SettingsGroup>
  );
}

function PaymentGroups({
  snapshot,
  commands,
  details,
}: {
  snapshot: PlanActionSnapshot;
  commands: PlanActionCommands;
  details: BillingDetails | undefined;
}) {
  if (!snapshot.hasBillingAccount) return null;
  const portalButton = (label: string) => (
    <Button
      variant="outline"
      size="sm"
      disabled={snapshot.showPortalOverlay}
      className={commands.shake.portal.className}
      onAnimationEnd={commands.shake.portal.end}
      onClick={commands.onPortal}
    >
      <BusyContent busy={snapshot.showPortalOverlay}>{label}</BusyContent>
    </Button>
  );
  const card = details?.card;
  return (
    <>
      <SettingsGroup title="Payment">
        <SettingsRow label="Card" hint={card ? undefined : "Kept by Polar, our payment provider."}>
          {card && <CardFace card={card} />}
          {portalButton("Update")}
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Invoices">
        {details?.invoices.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} />
        ))}
        {details?.invoices.length ? (
          <SettingsRow label="Older invoices and receipts" hint="In the subscription portal.">
            {portalButton("View invoices")}
          </SettingsRow>
        ) : (
          <SettingsRow
            label="Every invoice and receipt"
            hint="In the subscription portal, as PDFs."
          >
            {portalButton("View invoices")}
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  );
}

const CARD_BRANDS = new Map([
  ["amex", "American Express"],
  ["diners", "Diners Club"],
  ["jcb", "JCB"],
  ["unionpay", "UnionPay"],
]);

/** The brand as a word, not a logo: the CSP allows no remote image. */
function CardFace({ card }: { card: PaymentCard }) {
  const brand =
    CARD_BRANDS.get(card.brand) ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  const mm = String(card.expMonth).padStart(2, "0");
  const yy = String(card.expYear).slice(-2);
  return (
    <span className="flex items-center gap-2 text-sm tnum">
      <span className="shrink-0 rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap">
        {brand}
      </span>
      Ending {card.last4}, expires {mm}/{yy}
    </span>
  );
}

const INVOICE_STATUS = {
  paid: { label: "Paid", dot: "bg-accent-2" },
  open: { label: "Open", dot: "bg-butter" },
  refunded: { label: "Refunded", dot: "bg-muted" },
  credit: { label: "Credit", dot: "bg-muted" },
} satisfies Record<Invoice["status"], { label: string; dot: string }>;

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const status = INVOICE_STATUS[invoice.status];
  return (
    <div className="grid min-h-11 grid-cols-[1fr_auto_2rem] items-center gap-x-4 px-4 py-2 text-sm sm:grid-cols-[1fr_5rem_5rem_5rem_2rem]">
      <span className="tnum whitespace-nowrap">{shortDate(invoice.date)}</span>
      <span className="text-muted max-sm:hidden">
        {invoice.plan ? PLAN_LABEL[invoice.plan] : ""}
      </span>
      <span className="text-right tnum">{formatMoney(invoice.amountCents, invoice.currency)}</span>
      <span className="inline-flex items-center gap-1.5 text-xs max-sm:hidden">
        <span aria-hidden className={cn("size-1.5 rounded-full", status.dot)} />
        {status.label}
      </span>
      {invoice.pdfUrl ? (
        <Tooltip content="Download PDF">
          <a
            href={invoice.pdfUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download the invoice of ${shortDate(invoice.date)}`}
            className="grid size-8 place-items-center rounded-md text-muted transition-colors [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
          >
            <Download size={15} aria-hidden />
          </a>
        </Tooltip>
      ) : (
        <span />
      )}
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

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

function ClickUsageRow({ usage }: { usage: ClickUsage }) {
  const level = clickUsageLevel(usage.clicks, usage.limit);
  const now = Date.now();
  return (
    <UsageRow
      label="Clicks counted"
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
      {(limits.domains > 0 || snapshot.domainCount > 0) && (
        <UsageRow label="Custom domains" count={snapshot.domainCount} limit={limits.domains} />
      )}
      {snapshot.clickUsage && <ClickUsageRow usage={snapshot.clickUsage} />}
    </>
  );
}

function EnterpriseTerms({ limits }: { limits: PlanLimits }) {
  return (
    <>
      <SettingsRow label="Analytics history">
        <span className="text-sm tnum">{limits.analyticsDays} days</span>
      </SettingsRow>
      <SettingsRow label="QR logo and colors">
        <span className="text-sm">{limits.qrCustom ? "Yes" : "No"}</span>
      </SettingsRow>
      <SettingsRow label="Change your limits">
        {RDYRCT_SITE ? (
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Enterprise limits`}
            className="text-sm text-accent hover:underline"
          >
            Contact us
          </a>
        ) : (
          <span className="text-sm text-muted">Ask this instance's administrator</span>
        )}
      </SettingsRow>
    </>
  );
}

function showsOrgs(usage: UsageSnapshot): boolean {
  return usage.ownedOrgLimit > 1 || usage.ownedOrgs > usage.ownedOrgLimit;
}

function UsageInPlan({ usage }: { usage: UsageSnapshot }) {
  if (!usage.org) return null;
  return (
    <>
      <UsageRows snapshot={usage} limits={usage.org.limits} />
      {showsOrgs(usage) && (
        <UsageRow label="Organizations" count={usage.ownedOrgs} limit={usage.ownedOrgLimit} />
      )}
    </>
  );
}

function UsageGroup({ snapshot }: { snapshot: UsageSnapshot }) {
  if (!snapshot.org) return null;
  const limits = snapshot.org.limits;
  return (
    <SettingsGroup title="Usage" hint={snapshot.org.name}>
      <UsageRows snapshot={snapshot} limits={limits} />
      {showsOrgs(snapshot) && (
        <UsageRow
          label="Organizations you own"
          count={snapshot.ownedOrgs}
          limit={snapshot.ownedOrgLimit}
        />
      )}
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

function CelebrationOverlay({
  show,
  plan,
  onDismiss,
  onFirstLink,
}: {
  show: boolean;
  plan: OrgPlan;
  onDismiss: () => void;
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
          {/* The backdrop is the dismiss control, beside the card, not around it: a role="button" wrapper answered Enter and Space,
             so a key press on the card's button closed the overlay. */}
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
            <p className="text-xl font-bold text-accent">You’re on {PLAN_LABEL[plan]}.</p>
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

function useCelebration() {
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrate = useCallback(() => {
    setShowCelebration(true);
    const colors = ["#cdb9f5", "#b9e6c9", "#f5b8c8", "#f2e3b3", "#b9d9f0"];
    for (const angle of [60, 120]) {
      void confetti({
        particleCount: 40,
        angle,
        spread: 70,
        startVelocity: 50,
        origin: { x: angle === 60 ? 0 : 1, y: 0.75 },
        colors,
        disableForReducedMotion: true,
      });
    }
    setTimeout(() => setShowCelebration(false), 4000);
  }, []);
  return { showCelebration, setShowCelebration, celebrate };
}

/** Once only, and only for a free account: re-running would open checkout again behind the person's back. */
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
  // Kept so onGaveUp can ask Polar about this exact checkout if the webhook never shows up.
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
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
      // Remembered across the trip to Polar to tell whether the webhook has landed.
      // sessionStorage: nothing in memory survives the browser back button.
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

  // Reset overlay state when returning from Polar via bfcache.
  useEffect(() => {
    const handler = () => {
      setCheckoutPlan(null);
      setShowPortalOverlay(false);
      setConfirming(false);
      setConfirmTimedOut(false);
      setCheckoutId(null);
      setShowCelebration(false);
      // The portal sends nothing in the URL to notice, so without this bfcache restores the pre-visit state
      // (refetchOnWindowFocus is off for every query, src/app/main.tsx).
      void qc.refetchQueries({ queryKey: ["user"] });
      const before = sessionStorage.getItem(PORTAL_SNAPSHOT_KEY);
      if (before !== null) {
        sessionStorage.removeItem(PORTAL_SNAPSHOT_KEY);
        setPortalSnapshot(before);
      }
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, [qc, setShowCelebration]);

  const plan = currentUser.data?.user.plan ?? "free";
  const snapshot = billingSnapshot(portalState(currentUser.data?.user));

  useAwaitWebhook({
    waiting: portalSnapshot !== null,
    arrived: snapshot !== portalSnapshot,
    onArrived: () => setPortalSnapshot(null),
    onGaveUp: () => setPortalSnapshot(null),
  });

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

  // If the webhook has not landed when the poll gives up, ask Polar directly (POST /billing/checkout/:id/confirm).
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

function ownedOrgCount(orgs: { role: string }[] | undefined): number {
  return orgs?.filter((o) => o.role === "owner").length ?? 0;
}

function billingOverlayState(
  checkoutPlan: "hobby" | "pro" | null,
  showPortalOverlay: boolean,
  confirming: boolean,
) {
  return {
    show: checkoutPlan !== null || showPortalOverlay || confirming,
    message: confirming ? "Confirming your payment with Polar…" : "Redirecting to Polar…",
  };
}

const FREE_TIER: AccountTier = "free";

const NO_ACCOUNT_YET = {
  hasBillingAccount: false,
  comped: false,
  tier: FREE_TIER,
  limits: PLAN_LIMITS.free,
  polarSubscriptionCancelAtPeriodEnd: false,
  polarSubscriptionCurrentPeriodEnd: null,
  polarSubscriptionInterval: null,
};

function useBillingAccount() {
  const currentUser = useCurrentUser();
  const { hasBillingAccount, comped, ...subscription } = currentUser.data?.user ?? NO_ACCOUNT_YET;
  return {
    isLoading: currentUser.isLoading,
    hasBillingAccount,
    comped,
    cancelAtPeriodEnd: subscription.polarSubscriptionCancelAtPeriodEnd,
    periodEnd: subscription.polarSubscriptionCurrentPeriodEnd,
    interval: subscription.polarSubscriptionInterval,
    ownedOrgs: ownedOrgCount(currentUser.data?.orgs),
    tier: subscription.tier,
    limits: subscription.limits,
  };
}

function itemCount(items: readonly unknown[] | undefined): number {
  return items?.length ?? 0;
}

function quotaCount(quota: { count: number } | undefined): number | undefined {
  return quota?.count;
}

function useBillingUsageSnapshot(
  plan: OrgPlan,
  ownedOrgs: number,
  ownedOrgLimit: number,
): UsageSnapshot {
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
    ownedOrgLimit,
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
    void navigate({ to: "/dashboard" });
  };
}

function useBillingPageModel() {
  const account = useBillingAccount();
  const details = useBillingDetails(account.hasBillingAccount);
  const flow = useCheckoutFlow();
  const usage = useBillingUsageSnapshot(flow.plan, account.ownedOrgs, account.limits.orgs);
  const navigate = useNavigate();
  const dismissCelebration = () => flow.setShowCelebration(false);

  return {
    loading: account.isLoading || (account.hasBillingAccount && details.isPending),
    details: details.data,
    planActions: {
      snapshot: {
        plan: flow.plan,
        tier: account.tier,
        limits: account.limits,
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

export function preloadAccount(qc: QueryClient) {
  const billed = qc.getQueryData(userQuery.queryKey)?.user.hasBillingAccount ?? false;
  return settle([billed ? qc.ensureQueryData(billingDetailsQuery(true)) : undefined]);
}

export function preload(qc: QueryClient, orgId: string) {
  return settle([
    qc.ensureQueryData(linkQuotaUsageQuery(orgId)),
    qc.ensureQueryData(membersQuery(orgId)),
    qc.ensureQueryData(domainsQuery(orgId)),
    qc.ensureQueryData(clickUsageQuery(orgId)),
  ]);
}

export function BillingPage() {
  const model = useBillingPageModel();
  useSavePendingQrStyle();
  const { data: current } = useCurrentUser();
  const [changingPlan, setChangingPlan] = useState(false);
  if (current?.user.plan === "unlimited") return <NotFound />;

  // The shell cache is not an authority for plan or billing: its free defaults made the paid page flash first.
  if (model.loading) return <BillingSkeleton plan={current?.user.plan} />;

  const { snapshot, commands } = model.planActions;
  const free = snapshot.plan === "free";

  return (
    <div className="mx-auto w-full max-w-[760px]">
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
            <EnterpriseNote />
          </>
        ) : (
          <>
            <PaidPlan
              snapshot={snapshot}
              usage={model.usage}
              onChangePlan={() => setChangingPlan(true)}
              onPortal={commands.onPortal}
            />
            <PaymentGroups snapshot={snapshot} commands={commands} details={model.details} />
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
          {/* No org means no quota query, so the count never arrives. Checking out from a landing CTA before an org exists is that case. */}
          <CelebrationOverlay {...model.celebration} />
        </MotionConfig>
      </LazyMotion>
    </div>
  );
}
