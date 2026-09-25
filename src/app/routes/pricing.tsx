/**
 * Standalone pricing page (#261). "rdyrct pricing" is a real search, and this
 * is where somebody decides to pay, so it answers the question in the order
 * a buyer asks it: what the plans are, which one covers me, every limit, what
 * happens if I stop paying, and what the same thing costs elsewhere.
 *
 * The full table still lives in one place (PricingSection in landing.tsx),
 * and so does the downgrade timeline (PlanChangeSection).
 *
 * No self-host section here on purpose: a buying page that leads with "or pay
 * us nothing" argues against itself. Self-hosting stays a homepage trust
 * signal and a GitHub link in the footer.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MarketingPage } from "../components/marketing-page";
import { PlanChangeSection, PricingSection, usePaidPlanTo } from "./landing";
import { HrefLink } from "../lib/router-search";
import { trackCta } from "../lib/track-cta";
import { planFor, NEED_KEYS, type NeedKey, type Needs, type PlanFit } from "../lib/plan-finder";
import { formatNumber } from "../lib/numbers";
import { PLAN_LIMITS, PLAN_PRICES, type OrgPlan } from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { Table, Th, Td } from "../ui/misc";
import { Check } from "../ui/icons";
import { cn } from "../ui/cn";

const PLAN_NAMES = { free: "Free", hobby: "Hobby", pro: "Pro" } satisfies Record<OrgPlan, string>;
const PRICE = { free: "$0", hobby: PLAN_PRICES.hobby, pro: PLAN_PRICES.pro } satisfies Record<
  OrgPlan,
  string
>;

const CARDS = [
  {
    plan: "free",
    who: "For trying it and side projects",
    points: [
      `${PLAN_LIMITS.free.links} links`,
      `${PLAN_LIMITS.free.members} members`,
      `${PLAN_LIMITS.free.analyticsDays} days of analytics`,
      "A QR code for every link",
      "API and MCP",
    ],
  },
  {
    plan: "hobby",
    who: "For creators and small shops",
    points: [
      `${PLAN_LIMITS.hobby.links} links`,
      `${PLAN_LIMITS.hobby.members} members`,
      "1 custom domain, your own slugs",
      `${PLAN_LIMITS.hobby.analyticsDays} days of analytics`,
      "QR codes with your logo and colours",
    ],
  },
  {
    plan: "pro",
    who: "For brands and growing teams",
    points: [
      `${formatNumber(PLAN_LIMITS.pro.links)} links, ${PLAN_LIMITS.pro.orgs} organizations`,
      `${PLAN_LIMITS.pro.members} members`,
      `${PLAN_LIMITS.pro.domains} custom domains`,
      "A year of analytics",
      "Direct email support",
    ],
  },
] as const;

function PlanCards({ match }: { match: OrgPlan | null }) {
  return (
    <div className="grid gap-4 pt-10 md:grid-cols-3">
      {CARDS.map((card) => (
        <PlanCard key={card.plan} {...card} match={match === card.plan} />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  who,
  points,
  match,
}: {
  plan: OrgPlan;
  who: string;
  points: readonly string[];
  match: boolean;
}) {
  return (
    <div
      data-plan={plan}
      data-match={match}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-surface p-5 smooth-shadow-ring-xs transition-[box-shadow,transform] duration-300",
        match && "-translate-y-1 ring-2 ring-accent motion-reduce:translate-y-0",
      )}
    >
      <PlanHead plan={plan} match={match} />
      <PlanPrice plan={plan} />
      <p className="text-sm text-muted">{who}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-2">
            <Check size={14} className="shrink-0 text-accent-2" /> {point}
          </li>
        ))}
      </ul>
      <PlanCta plan={plan} />
    </div>
  );
}

function PlanHead({ plan, match }: { plan: OrgPlan; match: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="font-bold">{PLAN_NAMES[plan]}</p>
      {match && <span className="text-xs font-bold text-accent">Fits what you need</span>}
    </div>
  );
}

function PlanPrice({ plan }: { plan: OrgPlan }) {
  return (
    <p className="tnum text-4xl font-bold tracking-tight">
      {PRICE[plan]}
      {plan !== "free" && <span className="text-base font-normal text-muted"> a month</span>}
    </p>
  );
}

function PlanCta({ plan }: { plan: OrgPlan }) {
  const paidTo = usePaidPlanTo();
  if (plan === "free")
    return (
      <Link
        to="/signup"
        onClick={() => trackCta("pricing_free")}
        className={buttonClass({ variant: "outline", className: "mt-auto w-full" })}
      >
        Sign up free
      </Link>
    );
  const pro = plan === "pro";
  return (
    <HrefLink
      href={paidTo(plan)}
      onClick={() => trackCta(pro ? "pricing_pro" : "pricing_hobby")}
      className={buttonClass({ variant: pro ? "primary" : "outline", className: "mt-auto w-full" })}
    >
      Start {PLAN_NAMES[plan]}
    </HrefLink>
  );
}

/** Slider ranges. Links and days run on a log scale, so 12 and 45 are as
 * easy to reach as 3,000 and 365. */
const RANGES = {
  links: { label: "Links", min: 0, max: 5000, log: true },
  members: { label: "Team members", min: 1, max: 40, log: false },
  domains: { label: "Custom domains", min: 0, max: 10, log: false },
  analyticsDays: { label: "Days of analytics history", min: 1, max: 730, log: true },
} satisfies Record<NeedKey, { label: string; min: number; max: number; log: boolean }>;
const STEPS = 1000;

function toValue(key: NeedKey, position: number): number {
  const { min, max, log } = RANGES[key];
  const f = position / STEPS;
  return Math.round(log ? Math.expm1(f * Math.log1p(max - min)) + min : min + f * (max - min));
}

function toPosition(key: NeedKey, value: number): number {
  const { min, max, log } = RANGES[key];
  const x = Math.min(Math.max(value, min), max);
  const f = log ? Math.log1p(x - min) / Math.log1p(max - min) : (x - min) / (max - min);
  return Math.round(f * STEPS);
}

const clamp = (key: NeedKey, value: number) =>
  Math.min(Math.max(value, RANGES[key].min), RANGES[key].max);

function NeedSlider({
  id,
  value,
  onChange,
}: {
  id: NeedKey;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
      <label htmlFor={`need-${id}`} className="text-sm font-medium">
        {RANGES[id].label}
      </label>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`${RANGES[id].label}, exact number`}
        min={RANGES[id].min}
        max={RANGES[id].max}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(clamp(id, n));
        }}
        className="tnum h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm font-bold"
      />
      <input
        id={`need-${id}`}
        type="range"
        min={0}
        max={STEPS}
        value={toPosition(id, value)}
        onChange={(e) => onChange(toValue(id, Number(e.target.value)))}
        className="col-span-2 w-full accent-accent"
      />
    </div>
  );
}

const NEED_WORDS = {
  links: (n) => `${formatNumber(n)} links`,
  members: (n) => `${n} members`,
  domains: (n) => (n === 1 ? "a custom domain" : `${n} custom domains`),
  analyticsDays: (n) => `${formatNumber(n)} days of history`,
} satisfies Record<NeedKey, (n: number) => string>;

function fitReason(fit: PlanFit): string {
  if (fit.over.length === 0) return "Everything you picked fits the free plan.";
  const who = fit.below === "free" ? "the free plan" : PLAN_NAMES[fit.below ?? "pro"];
  const parts = fit.over.map(({ key, need, limit }) =>
    key === "domains" && limit === 0
      ? `${NEED_WORDS.domains(need)} needs a paid plan`
      : `${NEED_WORDS[key](need)} is past ${who}'s ${formatNumber(limit)}`,
  );
  const text = parts.join(", and ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function PlanFinder({
  needs,
  fit,
  onChange,
}: {
  needs: Needs;
  fit: PlanFit;
  onChange: (n: Needs) => void;
}) {
  return (
    <section className="flex flex-col gap-6 py-16">
      <div className="max-w-xl">
        <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          Which plan fits?
        </h2>
        <p className="mt-2 text-muted">
          Move the sliders to what you need. The plan that covers it lights up above.
        </p>
      </div>
      <div className="grid items-center gap-8 rounded-xl bg-surface p-5 smooth-shadow-ring-xs md:grid-cols-2">
        <div className="flex flex-col gap-5">
          {NEED_KEYS.map((key) => (
            <NeedSlider
              key={key}
              id={key}
              value={needs[key]}
              onChange={(value) => onChange({ ...needs, [key]: value })}
            />
          ))}
        </div>
        <div aria-live="polite" className="flex flex-col gap-2 rounded-lg bg-surface-2 p-5">
          <p className="text-xs text-muted">You need</p>
          <p className="text-2xl font-bold tracking-tight">
            {fit.plan
              ? `${PLAN_NAMES[fit.plan]}, ${PRICE[fit.plan]}${fit.plan === "free" ? "" : " a month"}`
              : "More than Pro"}
          </p>
          <p className="text-sm text-muted">
            {fit.plan
              ? fitReason(fit)
              : "That is past what Pro covers. Self-host rdyrct on your own Cloudflare account, or write to support@rdyrct.com."}
          </p>
        </div>
      </div>
    </section>
  );
}

/** One realistic case instead of a limit-by-limit table: on raw link and
 * domain counts some competitors beat us, on a team they do not. Prices and
 * seats as each vendor's pricing page stated them in September 2026; recheck
 * before changing a number. */
const TEAM_COSTS = [
  ["rdyrct Hobby", `${PLAN_PRICES.hobby} a month`, "5 members and 1 domain. Only the owner pays."],
  ["Short.io Team", "$48 a month", "Its Free, Hobby and Pro plans are one user each."],
  ["Rebrandly Growth", "$99 a month", "Essentials has no teammates; Professional starts at 2."],
  ["Dub Business", "$90 a month", "No free plan, a 14-day trial."],
  ["Bitly Enterprise", "Custom price", "The only Bitly plan that lists multiple users."],
] as const;

function TeamCostSection() {
  return (
    <section className="flex flex-col gap-6 py-16">
      <div className="max-w-xl">
        <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          A team of five with its own domain
        </h2>
        <p className="mt-2 text-muted">What that costs here, and at the best-known shorteners.</p>
      </div>
      <Table minWidth="min-w-xl">
        <thead>
          <tr>
            <Th>Plan</Th>
            <Th>Price</Th>
            <Th>Why that plan</Th>
          </tr>
        </thead>
        <tbody>
          {TEAM_COSTS.map(([plan, price, why], i) => (
            <tr key={plan} className={i === 0 ? "bg-accent/5" : undefined}>
              <Td className="font-bold">{plan}</Td>
              <Td className="tnum whitespace-nowrap">{price}</Td>
              <Td className="text-muted">{why}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-muted">
        From dub.co/pricing, short.io/pricing, rebrandly.com/pricing and bitly.com/pages/pricing,
        September 2026, monthly billing.
      </p>
    </section>
  );
}

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function PricingPage() {
  const [needs, setNeeds] = useState<Needs>({
    links: 120,
    members: 2,
    domains: 1,
    analyticsDays: 30,
  });
  const fit = planFor(needs);
  return (
    <MarketingPage
      path="/pricing"
      title="Simple pricing, start free"
      intro="Only the organization's owner pays. Everyone they invite works under the owner's plan."
    >
      <PlanCards match={fit.plan} />
      <PlanFinder needs={needs} fit={fit} onChange={setNeeds} />
      <div className="flex flex-col gap-2 pt-8">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Every limit, side by side</h2>
      </div>
      <PricingSection phoneCards={false} />
      <PlanChangeSection />
      <TeamCostSection />
      <section className="flex flex-col items-start gap-4 border-t border-border py-16">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Start free. Upgrade when you need your domain.
        </h2>
        <Link
          to="/signup"
          onClick={() => trackCta("pricing_free")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          Sign up free
        </Link>
        <p className="text-xs text-muted">
          No credit card. Picking a paid plan goes straight to checkout after sign-up.
        </p>
      </section>
    </MarketingPage>
  );
}
