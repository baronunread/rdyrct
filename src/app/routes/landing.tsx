// fallow-ignore-file code-duplication -- pricing table rows share structural pattern
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HrefLink } from "../lib/router-search";
import { Check, ChevronDown } from "@/app/ui/icons";
import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from "motion/react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useHydrated } from "../lib/hydrated";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { FaqJsonLd } from "../components/faq-json-ld";
import { MarketingLink } from "../components/marketing-link";
import { useAudience } from "../lib/audience";
import posthog from "../lib/posthog";
import { readConsent, useAnalyticsConsent } from "../lib/consent";
import { FUNNEL, landingContext } from "../lib/funnel";
import {
  heroVariantSnapshot,
  subscribeHeroVariant,
  syncHeroVariant,
  type HeroVariant,
} from "../lib/hero-variant";
import { trackCta } from "../lib/track-cta";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_PRICES_YEARLY,
  YEARLY_DISCOUNT_LABEL,
} from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { Table, Th, Td } from "../ui/misc";
import { Footer, GITHUB_URL } from "../ui/footer";
import { HeroShortener } from "../components/hero-shortener";
import { HeroSignedIn } from "../components/hero-signed-in";
import { LandingHeader } from "../components/landing-header";
import { WebMcpMarketingTools } from "../components/webmcp-marketing-tools";
import {
  AnalyticsPillar,
  LinksPillar,
  Manifesto,
  QrPillar,
  TeamsAndCode,
} from "../components/landing-pillars";
import { FrameRow, SplitHeading } from "../components/marketing-kit";
import { AnonLinkBar } from "../components/anon-link-bar";
import { formatNumber } from "../lib/numbers";
import { cn } from "../ui/cn";

const HeroGlobe = lazy(() => import("../components/hero-globe"));
const faqs = [
  {
    q: "Is the free plan really free?",
    a: `Yes: ${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.members} teammates, and ${PLAN_LIMITS.free.analyticsDays} days of click analytics, forever. No credit card required. Shared-domain links get random slugs; picking your own slug needs a custom domain (paid plans).`,
  },
  {
    q: "What's the difference between Hobby and Pro?",
    a: `Hobby (${PLAN_PRICES.hobby}/mo) puts your logo and colors on QR codes (plain ones are free), and adds a custom domain with your own slugs, ${PLAN_LIMITS.hobby.links} links, ${PLAN_LIMITS.hobby.members} team members, and ${PLAN_LIMITS.hobby.analyticsDays}-day analytics for one organization. Pro (${PLAN_PRICES.pro}/mo) raises everything: ${PLAN_LIMITS.pro.orgs} organizations, ${formatNumber(PLAN_LIMITS.pro.links)} links, ${PLAN_LIMITS.pro.members} team members, ${PLAN_LIMITS.pro.domains} custom domains each, ${PLAN_LIMITS.pro.analyticsDays}-day analytics, and direct email support. Only the organization owner needs a paid plan: one subscription covers every organization they own. Yearly billing saves 10%.`,
  },
  {
    q: "How is rdyrct privacy-friendly?",
    a: "Click analytics store only country, referrer, device type, and timestamp. Never an IP address, never a precise location, and no cross-site tracking.",
  },
  {
    q: "Can I track campaigns?",
    a: "Yes. Tag links with the built-in UTM builder, or paste a URL that already has UTM parameters, and rdyrct ranks campaigns, sources, and mediums by clicks. The analytics page also shows trends against the previous period, an activity heatmap, and links that have gone quiet, with windows from 24 hours to a year depending on your plan.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Paid plans include custom domains with automatic TLS through Cloudflare for SaaS: point your DNS at us and short links go live under your brand.",
  },
  {
    q: "Is this a free URL shortener?",
    a: `Yes. The free plan is a working link shortener: ${PLAN_LIMITS.free.links} short links, click tracking, and a free QR code generator, with no card and no trial clock. Paid plans add branded short links on your own domain, custom slugs, and longer analytics history.`,
  },
  {
    q: "Can I make a QR code with my logo?",
    a: "Yes, on a paid plan: point the QR at a short link you own, and see how many scans a poster, flyer or packaging insert produced. If you just want a QR code that works and looks good, no tracking needed, our QR code generator is free and needs no account: pick the dot and corner style, set the colors, drop in a logo, and download a PNG or an SVG.",
    aNode: (
      <>
        Yes, on a paid plan: point the QR at a short link you own, and see how many scans a poster,
        flyer or packaging insert produced. If you just want a QR code that works and looks good, no
        tracking needed, our{" "}
        <MarketingLink to="/qr-code-generator" className="text-accent hover:underline">
          QR code generator
        </MarketingLink>{" "}
        is free and needs no account: pick the dot and corner style, set the colors, drop in a logo,
        and download a PNG or an SVG.
      </>
    ),
  },
  {
    q: "Can I self-host instead?",
    a: "Yes. rdyrct is open source and deploys to your own Cloudflare account. You get everything Pro has, minus direct email support.",
  },
];

function Section({
  children,
  className = "py-16",
  id,
  onEnter,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  /** Fires once when the section scrolls into view. Used for the funnel's
   *  "pricing viewed" step, which is a scroll, not a click. */
  onEnter?: () => void;
}) {
  return (
    <m.section
      id={id}
      initial={false}
      onViewportEnter={onEnter}
      viewport={{ once: true, margin: "-80px" }}
      className={className}
    >
      {children}
    </m.section>
  );
}

type Tier = "free" | "hobby" | "pro";

function Cell({ tier, children }: { tier?: Tier; children?: ReactNode }) {
  return (
    <Td className={tier === "pro" ? "border-x border-x-accent/25 bg-accent/5" : undefined}>
      {children}
    </Td>
  );
}

function YesCell({ tier }: { tier?: Tier }) {
  return (
    <Cell tier={tier}>
      <Check size={15} className="text-accent-2" />
    </Cell>
  );
}

function NoCell({ tier }: { tier?: Tier }) {
  return (
    <Cell tier={tier}>
      <span className="text-muted">No</span>
    </Cell>
  );
}

/**
 * Where a paid-plan CTA sends people: logged-in users go straight to checkout
 * (/billing?plan=…), everyone else signs up first with that destination as
 * `next`, so the intent survives OTP verification.
 */
export function usePaidPlanTo() {
  // Through useAudience rather than useCurrentUser directly: this asks the
  // same question the header does ("is this a stranger?"), and asking it
  // twice meant asking the server twice, once through the gate that skips the
  // round trip for a browser that has never been signed in and once around
  // it. It also reads better while the query is in flight, where `authed`
  // falls back to what this browser was last time instead of "no".
  const { authed } = useAudience();
  return (plan: "hobby" | "pro", interval: "month" | "year" = "month") => {
    const dest = `/billing?plan=${plan}${interval === "year" ? "&interval=year" : ""}`;
    return authed ? dest : `/signup?next=${encodeURIComponent(dest)}`;
  };
}

/** Monthly / yearly switch for the pricing sections. Yearly shows the saving
 * so it is visible before a plan is picked. */
/** Same measured-pill approach as billing.tsx's `BillingCycleToggle`:
 * `layoutId` alone does not animate a plain conditional swap (no exit phase
 * for Framer to measure a "from" rect), so one persistent pill tweens to the
 * active button's own rect instead. */
function BillingCycleToggle({
  interval,
  onChange,
}: {
  interval: "month" | "year";
  onChange: (next: "month" | "year") => void;
}) {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<"month" | "year", HTMLButtonElement | null>>({
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
    // clientLeft/Top: an absolute child is placed from the padding box, so the
    // container's 1px border has to come off or the pill sits 1px low.
    setPillRect({
      left: b.left - c.left - container.clientLeft,
      top: b.top - c.top - container.clientTop,
      width: b.width,
      height: b.height,
    });
  }, [interval]);

  return (
    <LazyMotion features={domAnimation}>
      <div
        ref={containerRef}
        className="relative mx-auto mb-8 flex w-fit items-center gap-1 rounded-xl bg-surface-2 p-1 text-sm"
      >
        {pillRect && (
          <m.span
            className="smooth-shadow-ring-xs absolute rounded-lg bg-surface"
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
            aria-pressed={interval === value}
            onClick={() => onChange(value)}
            className={cn(
              "relative min-h-11 rounded-lg px-3 py-1 font-medium transition-colors sm:min-h-0",
              interval === value ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {value === "month" ? "Monthly" : `Yearly · ${YEARLY_DISCOUNT_LABEL}`}
          </button>
        ))}
      </div>
    </LazyMotion>
  );
}

/** The price line for a paid plan at the chosen interval: "$4/mo", or
 * "$3.60/mo" with a "billed yearly" sub-line the caller renders. */
function planPrice(plan: "hobby" | "pro", interval: "month" | "year") {
  return interval === "year" ? `${PLAN_PRICES_YEARLY[plan]}/mo` : `${PLAN_PRICES[plan]}/mo`;
}

/** A tier's name, with the "Best value" pill on the highlighted one. Never
 * "Most popular": nothing backs that, and per link Pro costs about a third of
 * Hobby, which the limits do. */
function PlanName({ name, highlight }: { name: string; highlight?: boolean }) {
  return (
    <p className="font-bold">
      {name}
      {highlight && (
        <span className="ml-2 rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent">
          Best value
        </span>
      )}
    </p>
  );
}

/** One tier in the mobile plan stack. Its own component (not an inline
 * `.map` callback) so the price/sub-line/feature-list render logic has a
 * name and isn't retyped as a 7-prop JSX closure on every tier. */
function MobilePlanCard({
  name,
  tagline,
  price,
  sub,
  features,
  cta,
  highlight,
}: {
  name: string;
  tagline: string;
  price: string;
  sub: string;
  features: string[];
  cta: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <PlanName name={name} highlight={highlight} />
          <p className="text-xs text-muted">{tagline}</p>
        </div>
        <p className="tnum text-base font-bold">
          {price}
          {sub && <span className="block text-2xs font-normal text-muted">{sub}</span>}
        </p>
      </div>
      <ul className="my-4 flex flex-col gap-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-sm text-muted">
            <Check size={14} className="mt-0.5 shrink-0 text-accent-2" />
            {f}
          </li>
        ))}
      </ul>
      {cta}
    </div>
  );
}

/** Stacked plan cards for phones, where the comparison table can't breathe. */
function MobilePlans({
  paidTo,
  interval,
}: {
  paidTo: (p: "hobby" | "pro", interval: "month" | "year") => string;
  interval: "month" | "year";
}) {
  const yearly = interval === "year";
  const tiers = [
    {
      name: "Free",
      tagline: "For side projects",
      price: "$0",
      sub: "",
      features: [
        `${PLAN_LIMITS.free.links} links`,
        `${PLAN_LIMITS.free.members} team members`,
        `${PLAN_LIMITS.free.analyticsDays}-day click analytics`,
        "QR codes",
        "Random slugs on the shared domain",
      ],
      cta: (
        <Link
          to="/signup"
          onClick={() => trackCta("pricing_free")}
          className={buttonClass({ variant: "outline", size: "sm", className: "w-full" })}
        >
          Sign up free
        </Link>
      ),
    },
    {
      name: "Hobby",
      tagline: "For creators & solo brands",
      price: planPrice("hobby", interval),
      sub: yearly ? "billed yearly" : "",
      features: [
        `${PLAN_LIMITS.hobby.links} links`,
        `${PLAN_LIMITS.hobby.members} team members`,
        `${PLAN_LIMITS.hobby.domains} custom domain with your own slugs`,
        "QR codes with your logo and colors",
        `${PLAN_LIMITS.hobby.analyticsDays}-day click analytics`,
      ],
      cta: (
        <HrefLink
          href={paidTo("hobby", interval)}
          onClick={() => trackCta("pricing_hobby")}
          className={buttonClass({ variant: "outline", size: "sm", className: "w-full" })}
        >
          Start Hobby
        </HrefLink>
      ),
    },
    {
      name: "Pro",
      tagline: "For brands & growing teams",
      price: planPrice("pro", interval),
      sub: yearly ? "billed yearly" : "",
      highlight: true,
      features: [
        `${PLAN_LIMITS.pro.orgs} organizations (only the owner pays)`,
        `${formatNumber(PLAN_LIMITS.pro.links)} links`,
        `${PLAN_LIMITS.pro.members} team members`,
        `${PLAN_LIMITS.pro.domains} custom domains each`,
        `${PLAN_LIMITS.pro.analyticsDays}-day click analytics`,
        "Direct email support",
      ],
      cta: (
        <HrefLink
          href={paidTo("pro", interval)}
          onClick={() => trackCta("pricing_pro")}
          className={buttonClass({ variant: "primary", size: "sm", className: "w-full" })}
        >
          Start Pro
        </HrefLink>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 sm:hidden">
      {tiers.map((tier) => (
        <MobilePlanCard key={tier.name} {...tier} />
      ))}
      <p className="text-center text-xs text-muted">
        Prefer your own infra? rdyrct is open source:{" "}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          self-host it
        </a>{" "}
        on your Cloudflare account, free, with everything Pro has.
      </p>
    </div>
  );
}

/**
 * Four-tier comparison table (self-hosted / Free / Hobby / Pro). Exported
 * for the standalone /pricing page, which reuses it rather than forking a
 * second table that could drift from this one.
 *
 * No heading of its own: the page that renders this owns the page-level
 * h1 and subtitle immediately above it (see PricingPage),
 * and this used to repeat both, word for word, right under them.
 */
/** The full plan table. On a phone it is stacked cards, unless the page
 * already shows the plans as cards above it (`/pricing`), where the table
 * scrolls sideways instead of repeating them. */
export function PricingSection({ phoneCards = true }: { phoneCards?: boolean }) {
  const paidTo = usePaidPlanTo();
  const [interval, setInterval] = useState<"month" | "year">("month");
  return (
    <Section
      id="pricing"
      className="scroll-mt-16 py-16"
      onEnter={() => posthog.capture(FUNNEL.pricingViewed)}
    >
      <BillingCycleToggle interval={interval} onChange={setInterval} />

      {phoneCards && <MobilePlans paidTo={paidTo} interval={interval} />}

      <PricingTable phoneCards={phoneCards} paidTo={paidTo} interval={interval} />
    </Section>
  );
}

/** The full plan table, shown from the `sm` breakpoint up (always, when there
 * are no phone cards to stand in for it on a narrow screen). */
function PricingTable({
  phoneCards,
  paidTo,
  interval,
}: {
  phoneCards: boolean;
  paidTo: ReturnType<typeof usePaidPlanTo>;
  interval: "month" | "year";
}) {
  const yearlyTag =
    interval === "year" ? (
      <span className="ml-1 text-2xs font-normal text-muted">yearly</span>
    ) : null;
  return (
    <div className={phoneCards ? "hidden sm:block" : undefined}>
      <Table
        minWidth={phoneCards ? undefined : "min-w-2xl"}
        // tnum: the prices change width with the billing toggle otherwise.
        className="lit tnum rounded-3xl border border-border"
      >
        <thead>
          <tr>
            <Th></Th>
            <Th>
              Free
              <span className="mt-0.5 block normal-case tracking-normal text-muted">
                For side projects
              </span>
            </Th>
            <Th>
              Hobby
              <span className="mt-0.5 block normal-case tracking-normal text-muted">
                For creators & solo brands
              </span>
            </Th>
            <Th className="border-x border-x-accent/25 bg-accent/10">
              {/* "Best value", not "Most popular": per link Pro costs about a
                third of Hobby, which the limits table backs. */}
              <span className="inline-flex items-center gap-2 text-accent">
                Pro
                <span className="rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent">
                  Best value
                </span>
              </span>
              <span className="mt-0.5 block normal-case tracking-normal text-accent">
                For brands & growing teams
              </span>
            </Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td className="font-bold">Price</Td>
            <Td>$0</Td>
            <Td>
              <span className="text-base font-bold">{planPrice("hobby", interval)}</span>
              {yearlyTag}
            </Td>
            <Cell tier="pro">
              <span className="text-base font-bold text-accent">{planPrice("pro", interval)}</span>
              {yearlyTag}
              <span className="block text-xs font-normal text-muted">only the org owner pays</span>
            </Cell>
          </tr>
          <tr>
            <Td className="font-bold">Organizations</Td>
            <Td>{PLAN_LIMITS.free.orgs}</Td>
            <Td>{PLAN_LIMITS.hobby.orgs}</Td>
            <Cell tier="pro">{PLAN_LIMITS.pro.orgs}</Cell>
          </tr>
          <tr>
            <Td className="font-bold">Links</Td>
            <Td>{PLAN_LIMITS.free.links}</Td>
            <Td>{PLAN_LIMITS.hobby.links}</Td>
            <Cell tier="pro">{formatNumber(PLAN_LIMITS.pro.links)}</Cell>
          </tr>
          <tr>
            <Td className="font-bold">Custom slugs</Td>
            <Td className="text-muted">Random only</Td>
            <Td>On your domain</Td>
            <Cell tier="pro">On your domains</Cell>
          </tr>
          <tr>
            <Td className="font-bold">Team members</Td>
            <Td>{PLAN_LIMITS.free.members}</Td>
            <Td>{PLAN_LIMITS.hobby.members}</Td>
            <Cell tier="pro">{PLAN_LIMITS.pro.members}</Cell>
          </tr>
          <tr>
            <Td className="font-bold">QR codes</Td>
            <YesCell />
            <YesCell />
            <YesCell tier="pro" />
          </tr>
          <tr>
            <Td className="font-bold">QR logo, colors, and shapes</Td>
            <NoCell />
            <YesCell />
            <YesCell tier="pro" />
          </tr>
          <tr>
            <Td className="font-bold">Custom domains</Td>
            <Td className="text-muted">No</Td>
            <Td>{PLAN_LIMITS.hobby.domains}</Td>
            <Cell tier="pro">{PLAN_LIMITS.pro.domains}</Cell>
          </tr>
          <tr>
            <Td className="font-bold">Analytics history</Td>
            <Td>{PLAN_LIMITS.free.analyticsDays} days</Td>
            <Td>{PLAN_LIMITS.hobby.analyticsDays} days</Td>
            <Cell tier="pro">{PLAN_LIMITS.pro.analyticsDays} days</Cell>
          </tr>
          <tr>
            <Td className="font-bold">Support</Td>
            <Td>GitHub issues</Td>
            <Td>GitHub issues</Td>
            <Cell tier="pro">Direct email support</Cell>
          </tr>
          <tr>
            <Td />
            <Td>
              <Link
                to="/signup"
                onClick={() => trackCta("pricing_free")}
                className={buttonClass({ variant: "outline", size: "sm", className: "w-full" })}
              >
                Sign up free
              </Link>
            </Td>
            <Td>
              <HrefLink
                href={paidTo("hobby", interval)}
                onClick={() => trackCta("pricing_hobby")}
                className={buttonClass({ variant: "outline", size: "sm", className: "w-full" })}
              >
                Start Hobby
              </HrefLink>
            </Td>
            <Cell tier="pro">
              <HrefLink
                href={paidTo("pro", interval)}
                onClick={() => trackCta("pricing_pro")}
                className={buttonClass({ variant: "primary", size: "sm", className: "w-full" })}
              >
                Start Pro
              </HrefLink>
            </Cell>
          </tr>
        </tbody>
      </Table>
    </div>
  );
}

/**
 * Self-hosting used to be the pricing table's first column, so a buyer read
 * "free, unlimited, your infra" before reaching a price. Every open-source
 * SaaS worth copying keeps it off the buying surface: Dub does not mention it
 * on /pricing at all, Cal.com and Ghost give it a footer link.
 *
 * So it gets a band of its own, after the prices, and it makes one claim
 * rather than a table of them. No card around it: the claim carries itself.
 */

/** The GitHub mark, inline. The icon set has no brand icons, and the CSP
 *  forbids fetching one, so the path lives here. */
function GithubMark({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** The self-host steps as they are in the README, not a tidied version:
 *  somebody deciding whether to trust the open-source claim checks this. */
const SELF_HOST_STEPS = [
  ["git clone", "https://github.com/baronunread/rdyrct"],
  ["bun install", ""],
  ["bunx wrangler d1 create", "rdyrct"],
  ["bun run db:migrate:remote && bun run deploy", ""],
] as const;

const SELF_HOST_FACTS = [
  "MIT licensed, with no enterprise edition held back.",
  "Runs on your own Cloudflare account.",
  "You are the platform admin, so you set your own plan.",
];

function SelfHostSection() {
  return (
    // Its own section after pricing, never a column inside it: it answers
    // "will this still be here next year", and the answer is the code.
    <Section id="self-host" className="py-16 md:py-24">
      <div className="lit grid overflow-hidden rounded-3xl border border-border bg-surface md:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-6 p-6 sm:p-10">
          <SplitHeading lead="Run it yourself." rest="The same code, on your own account." />
          <ul className="flex flex-col gap-2 text-muted">
            {SELF_HOST_FACTS.map((fact) => (
              <li key={fact} className="flex gap-2.5">
                <Check size={16} className="mt-1 shrink-0 text-accent-2" />
                {fact}
              </li>
            ))}
          </ul>
          {/* No star count: a low number reads as a weekend project to the
              exact reader this section is for. */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({
              variant: "outline",
              className: "w-fit gap-2 rounded-full px-4",
            })}
          >
            <GithubMark size={16} />
            Read the source on GitHub
          </a>
        </div>
        <SelfHostTerminal />
      </div>
    </Section>
  );
}

function SelfHostTerminal() {
  return (
    <div className="ink-band flex flex-col border-t border-border md:border-t-0 md:border-l">
      <div aria-hidden="true" className="flex gap-1.5 border-b border-border px-4 py-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-7 sm:p-6">
        {SELF_HOST_STEPS.map(([command, arg]) => (
          <code key={command} className="block whitespace-pre">
            <span className="text-muted select-none">$ </span>
            {command}
            {arg && <span className="text-accent"> {arg}</span>}
          </code>
        ))}
      </pre>
      <p className="mt-auto border-t border-border px-5 py-4 text-sm text-muted sm:px-6">
        Secrets, a domain and the rest are in the{" "}
        <a
          href={`${GITHUB_URL}#deploy-to-cloudflare-workers`}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          setup guide
        </a>
        .
      </p>
    </div>
  );
}

/**
 * The hero: one line on what you get, the words people search for under it,
 * then the working shortener, over a globe of clicks hopping between cities.
 * The heading is under a copy test (HeroCopy); the layout is not.
 *
 * The layout came out of an earlier test (headline and CTA beside the
 * shortener, against shortener first): 4 signups each from about 70
 * visitors, so it ended and kept the second arm's idea, the demo centre
 * stage, straight under the pitch.
 *
 * Everything a crawler or a link preview reads (the heading, the copy, the
 * links) is plain prerendered HTML. The globe is decoration: it loads after
 * hydration into a box this section reserves, so it never shifts the layout
 * or competes with the heading for the first paint.
 */
/** One landing view per page load, once consent and the session have both
 *  answered. */
function useLandingViewCapture(ready: boolean, authed: boolean) {
  const captured = useRef(false);
  const { ready: consentReady, accepted: analyticsConsent } = useAnalyticsConsent();
  // The copy test: flip the coin once consent and the session have answered,
  // and forget the arm if consent goes. Before the view is captured, so the
  // view carries the arm it was shown.
  useEffect(() => {
    syncHeroVariant({ consentReady, consented: analyticsConsent, sessionReady: ready, authed });
  }, [ready, authed, consentReady, analyticsConsent]);
  useEffect(() => {
    if (!shouldCaptureLandingView(consentReady, ready, captured.current)) return;
    captured.current = true;
    posthog.capture(FUNNEL.landingViewed, landingContext());
  }, [ready, authed, consentReady, analyticsConsent]);
}

function HeroSection({ ctaTo, ctaLabel, authed, ready, name }: HeroProps) {
  const hydrated = useHydrated();
  const settled = hydrated && ready;
  useLandingViewCapture(ready, authed);

  return (
    <section
      data-hero
      // Until the session resolves, a cached customer's browser hides the
      // anonymous pitch (styles.css) instead of flashing it.
      data-ssr={settled ? undefined : ""}
      className="relative flex flex-col items-center pt-14 pb-12 text-center md:pt-20 md:pb-16"
    >
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
        <HeroCopy part="title" authed={authed} settled={settled} />
      </h1>
      <p className="mt-5 max-w-xl text-base text-pretty text-muted sm:text-lg">
        <HeroCopy part="sub" authed={authed} settled={settled} />
      </p>

      <HeroCta ctaTo={ctaTo} ctaLabel={ctaLabel} hidden={authed} />

      {/* The card overlaps the top of the globe, so the thing you can use sits
          in front of the picture of what it does. */}
      <HeroCard authed={authed} name={name} />

      <HeroGlobeStage hydrated={hydrated} />
    </section>
  );
}

/**
 * The two arms of the hero copy test (lib/hero-variant.ts). "Free" stays out
 * of both: it lives by the button, where it helps the click instead of
 * cheapening the pitch. Both lines carry the words people search for.
 */
const HERO_COPY = {
  own: {
    title: "Turn long links into your own.",
    sub: "A URL shortener and QR code generator on your own domain, with every click's country, referrer and device. No ad page, and no IP address stored.",
  },
  answers: {
    title: "The link shortener that answers to you.",
    sub: "A URL shortener and QR code generator on your own domain. Open source, no ad page, and no IP address stored.",
  },
} satisfies Record<HeroVariant, { title: string; sub: string }>;

/**
 * One line of the hero in the arm this browser was given. Until the page has
 * hydrated and the session answered, both arms are in the HTML and CSS shows
 * the one index.html picked before paint (styles.css), so nothing flips.
 * After that only the active arm is rendered. A signed-in visitor always
 * reads the control and never flips the coin.
 */
function HeroCopy({
  part,
  authed,
  settled,
}: {
  part: "title" | "sub";
  authed: boolean;
  settled: boolean;
}) {
  const variant = useSyncExternalStore(
    subscribeHeroVariant,
    heroVariantSnapshot,
    (): HeroVariant => "own",
  );
  if (settled) return HERO_COPY[authed ? "own" : variant][part];
  return (
    <>
      <span data-hero-copy="own">{HERO_COPY.own[part]}</span>
      {/* Drawn from an attribute, not text, so the prerendered heading a
          crawler reads is one line, not both arms run together. */}
      <span data-hero-copy="answers" data-text={HERO_COPY.answers[part]} />
    </>
  );
}

/**
 * The anonymous shortener is an argument aimed at a stranger. A signed-in
 * visitor has already been convinced, and offering them a link that expires
 * in 24 hours and can be "kept" by signing up for the account they are in
 * reads as nobody having tried it.
 */
function HeroCard({ authed, name }: { authed: boolean; name: string }) {
  return (
    <div
      data-hero-personalization
      className="relative z-10 mt-10 flex w-full justify-center md:mt-12"
    >
      {authed ? <HeroSignedIn name={name} /> : <HeroShortener />}
    </div>
  );
}

/** The globe's box, reserved in the prerendered HTML so the globe can arrive
 *  after hydration without moving anything. */
function HeroGlobeStage({ hydrated }: { hydrated: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="relative -mt-28 h-80 w-full overflow-hidden border-b border-border sm:h-96 md:-mt-32 md:h-120"
    >
      {hydrated && (
        <Suspense>
          <HeroGlobe />
        </Suspense>
      )}
    </div>
  );
}

function HeroCta({
  ctaTo,
  ctaLabel,
  hidden,
}: {
  ctaTo: string;
  ctaLabel: string;
  hidden: boolean;
}) {
  if (hidden) return null;
  return (
    <div
      data-hero-personalization
      className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-5"
    >
      <HrefLink
        href={ctaTo}
        onClick={() => trackCta("hero_primary")}
        className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
      >
        {ctaLabel}
      </HrefLink>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
        <li className="flex items-center gap-1.5">
          <Check size={14} className="text-accent-2" /> Free plan forever
        </li>
        <li className="flex items-center gap-1.5">
          <Check size={14} className="text-accent-2" /> No credit card
        </li>
      </ul>
    </div>
  );
}

function shouldCaptureLandingView(consentReady: boolean, ready: boolean, captured: boolean) {
  return consentReady && ready && !captured && readConsent() === "accepted";
}

type HeroProps = {
  ctaTo: string;
  ctaLabel: string;
  authed: boolean;
  ready: boolean;
  /** Empty until the session resolves; the card handles that itself. */
  name: string;
};

/** The one ask in the long stretch between the hero and pricing, where the
 *  visitor has just been shown the payoff. */
function AnalyticsAsk() {
  const { authed } = useAudience();
  return (
    <HrefLink
      href={authed ? "/analytics" : "/signup"}
      onClick={() => trackCta("analytics_preview")}
      className={buttonClass({ variant: "primary", className: "rounded-full px-4" })}
    >
      See this on your own links
    </HrefLink>
  );
}

/**
 * What happens when somebody stops paying, said as a sequence because it is
 * one (#29, #159). QR tools that switch printed codes off when a trial ends
 * are the reason this earns a section: nobody else says it on their homepage.
 */
const PLAN_CHANGE_STEPS = [
  ["Day 0", "You downgrade", "Nothing is deleted. We email you what is over the new plan."],
  ["Day 23", "A second email", "A reminder a week before anything changes."],
  [
    "Day 30",
    "Custom domain links pause",
    "Links on your own domain stop until you upgrade again, then come straight back.",
  ],
  [
    "Always",
    "Links on rdyr.cc keep working",
    "On every plan, paid or free, a code printed with an rdyr.cc link keeps working.",
  ],
] as const;

/** The page's one dark band: the promise that matters most to somebody
 *  about to print a code. The last step, the one that never changes, is the
 *  lit one. */
export function PlanChangeSection() {
  return (
    <Section className="ink-band flex flex-col gap-10 rounded-3xl px-6 py-14 sm:px-10 md:py-20">
      <SplitHeading
        lead="Stop paying, and nothing gets deleted."
        rest="What happens, in order, after you downgrade."
      />
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CHANGE_STEPS.map(([when, head, body], index) => (
          <li
            key={when}
            className={cn(
              "lit flex flex-col gap-1 rounded-2xl border border-border bg-surface p-5",
              index === PLAN_CHANGE_STEPS.length - 1 && "border-accent/50",
            )}
          >
            <span className="tnum text-sm font-bold text-accent">{when}</span>
            <p className="mt-1 font-bold">{head}</p>
            <p className="text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function FaqSection() {
  return (
    // Left, not centred. Reading is one column, and centring a list of
    // questions starts every line in a different place.
    <Section
      id="faq"
      className="grid scroll-mt-24 gap-8 py-16 md:grid-cols-[1fr_1.6fr] md:gap-12 md:py-24"
    >
      <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        Frequently asked questions
      </h2>
      <div className="flex flex-col border-b border-border">
        {faqs.map(({ q, a, aNode }) => (
          <details key={q} className="group border-t border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-5 font-bold [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown
                size={16}
                className="shrink-0 text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <p className="max-w-prose pb-4 text-sm text-muted">{aNode ?? a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/** The page's last word: a dark band as wide as the column, so the page
 *  ends on something, not on a gap. */
function FinalCtaSection({ ctaTo, ctaLabel }: { ctaTo: string; ctaLabel: string }) {
  return (
    <Section className="ink-band relative isolate mt-8 overflow-hidden rounded-3xl border border-border px-6 py-20 md:py-32">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] mask-[radial-gradient(60%_70%_at_50%_45%,#000,transparent)]"
      />
      <div
        aria-hidden="true"
        className="landing-mesh absolute top-1/2 left-1/2 -z-10 h-80 w-160 max-w-full -translate-1/2 opacity-40"
      />
      <div className="flex flex-col items-center gap-6 text-center">
        <h2 className="text-metal max-w-3xl pb-1 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
          Your next link, one hop away.
        </h2>
        <p className="max-w-lg text-pretty text-muted">
          Your first short link takes a minute on the free plan. No credit card.
        </p>
        <HrefLink
          href={ctaTo}
          onClick={() => trackCta("final_cta")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          {ctaLabel}
        </HrefLink>
      </div>
    </Section>
  );
}

/**
 * Three price points and a link to the full comparison, in place of the full
 * table this section used to carry.
 *
 * The homepage's job is "worth a click"; a full four-column table with a
 * self-host row and a feature-by-feature breakdown is the down-funnel page's
 * job, and having both meant the same table twice, word for word, competing
 * with itself for "rdyrct pricing" in search. Stripe, Linear and Vercel all
 * draw this line the same place: a light teaser on the homepage, the detail
 * on its own page.
 */
/** One tier in the homepage pricing teaser. Its own component for the same
 * reason as MobilePlanCard above: a named unit beats a 9-prop `.map` closure. */
function PricingTierCard({
  name,
  price,
  sub,
  pitch,
  to,
  cta,
  variant,
  onClick,
  highlight,
}: {
  name: string;
  price: string;
  sub: string;
  pitch: string;
  to: string;
  cta: string;
  variant: "outline" | "primary";
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-6",
        highlight &&
          "bg-[radial-gradient(70%_120px_at_50%_0,color-mix(in_oklab,var(--accent)_12%,transparent),transparent)]",
      )}
    >
      <div>
        {/* Same pill as the full table and the mobile plan cards. The
            homepage is where the steering is worth most, and it was the
            one of the three missing it. */}
        <PlanName name={name} highlight={highlight} />
        <p className="tnum mt-2 text-4xl font-bold tracking-tight">
          {price}
          {sub && <span className="ml-1 text-2xs font-normal text-muted">{sub}</span>}
        </p>
        <p className="mt-1 text-sm text-muted">{pitch}</p>
      </div>
      <HrefLink
        href={to}
        onClick={onClick}
        className={buttonClass({ variant, size: "sm", className: "mt-auto w-full" })}
      >
        {cta}
      </HrefLink>
    </div>
  );
}

function PricingTeaser() {
  const paidTo = usePaidPlanTo();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const yearly = interval === "year";
  const tiers = [
    {
      name: "Free",
      price: "$0",
      sub: "",
      // Says the generous part and the catch in one line. The free teammates
      // are the strongest free thing here and were missing; the random slugs
      // are the fact most likely to feel like a bait if somebody only meets
      // it after signing up, and it was buried in a collapsed FAQ.
      pitch: `${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.members} teammates, QR codes, and ${PLAN_LIMITS.free.analyticsDays}-day click analytics. Slugs on our domain are always random.`,
      to: "/signup",
      cta: "Sign up free",
      variant: "outline" as const,
      onClick: () => trackCta("pricing_free"),
    },
    {
      name: "Hobby",
      price: planPrice("hobby", interval),
      sub: yearly ? "billed yearly" : "",
      pitch: `${PLAN_LIMITS.hobby.links} links, a custom domain with your own slugs, QR codes with your logo and colors, ${PLAN_LIMITS.hobby.members} team members, and ${PLAN_LIMITS.hobby.analyticsDays}-day analytics.`,
      to: paidTo("hobby", interval),
      cta: "Start Hobby",
      variant: "outline" as const,
      onClick: () => trackCta("pricing_hobby"),
    },
    {
      name: "Pro",
      price: planPrice("pro", interval),
      sub: yearly ? "billed yearly" : "",
      pitch: `Everything in Hobby, plus ${PLAN_LIMITS.pro.orgs} organizations, ${formatNumber(PLAN_LIMITS.pro.links)} links, ${PLAN_LIMITS.pro.domains} custom domains, ${PLAN_LIMITS.pro.members} team members, and ${PLAN_LIMITS.pro.analyticsDays}-day analytics.`,
      to: paidTo("pro", interval),
      cta: "Start Pro",
      variant: "primary" as const,
      onClick: () => trackCta("pricing_pro"),
      highlight: true,
    },
  ];

  return (
    <Section
      id="pricing"
      className="scroll-mt-16 py-16"
      onEnter={() => posthog.capture(FUNNEL.pricingViewed)}
    >
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Simple pricing
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
          Start free. Upgrade when you outgrow the plan, or self-host and never pay us a cent.
        </p>
      </div>

      <BillingCycleToggle interval={interval} onChange={setInterval} />

      <div className="lit grid grid-cols-1 divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {tiers.map((tier) => (
          <PricingTierCard key={tier.name} {...tier} />
        ))}
      </div>

      <p className="mt-6 text-center text-sm">
        <MarketingLink to="/pricing" className="text-accent hover:underline">
          See the full comparison →
        </MarketingLink>
      </p>
    </Section>
  );
}

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function LandingPage() {
  const { authed, ready, name, ctaTo, ctaLabel } = useAudience();

  // The words people type when they are looking for this, in the title and
  // the description a result actually shows: "url shortener" and "qr code
  // generator" rather than only the brand and the tagline.
  useSeo("/");

  useMarketingScroll();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="page-column">
          <FaqJsonLd faqs={faqs} />
          <WebMcpMarketingTools />
          <style>{`@keyframes cursorBlink { 50% { opacity: 0; } }`}</style>
          {/* First focusable thing on the page, so a keyboard user can jump
              past the header nav. Hidden until it takes focus. */}
          <a
            href="#main"
            className="sr-only rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-3 focus:left-6 focus:z-50 focus:outline-2 focus:outline-accent"
          >
            Skip to content
          </a>
          <LandingHeader authed={authed} />
          <main id="main">
            <HeroSection
              ctaTo={ctaTo}
              ctaLabel={ctaLabel}
              authed={authed}
              ready={ready}
              name={name}
            />
            {/* Below the hero, everything sits in one hairline frame
                (rdyrct-design, "Light on the marketing pages"). */}
            <div className="mb-16 border-x border-border/70">
              <Manifesto />
              <LinksPillar />
              <QrPillar />
              <AnalyticsPillar ask={<AnalyticsAsk />} />
              <TeamsAndCode />
              <FrameRow />
            </div>
            <PlanChangeSection />
            <PricingTeaser />
            <SelfHostSection />
            <FaqSection />
            <FinalCtaSection ctaTo={ctaTo} ctaLabel={ctaLabel} />
          </main>

          <Footer />
          {!authed && <AnonLinkBar />}
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
