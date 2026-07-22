// fallow-ignore-file code-duplication -- pricing table rows share structural pattern
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Link2,
  QrCode,
  Globe,
  Users,
  BarChart3,
  ShieldCheck,
  Check,
  Code2,
  ChevronDown,
  Target,
  TrendingDown,
  Activity,
} from "lucide-react";
import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion, type Variants } from "motion/react";
import { useState } from "react";
import { useCurrentUser } from "../lib/hooks";
import { readAuthHint } from "../lib/auth-hint";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { Button } from "../ui/button";
import { Table, Th, Td } from "../ui/misc";
import { Footer, GITHUB_URL } from "../ui/footer";
import { LandingMockup } from "../components/landing-mockup";
import { LandingAnalyticsMock } from "../components/landing-analytics";
import { cn } from "../ui/cn";

const steps = [
  {
    title: "Paste your URL",
    body: "Drop in any long link and tag it with the built-in UTM builder. On your own domain, pick any slug you like.",
  },
  {
    title: "Share it anywhere",
    body: "Use it as a short link or a scannable QR code, served from our domain or your own.",
  },
  {
    title: "See who's clicking",
    body: "Country, referrer, device, and campaign breakdowns update in real time, without storing a single IP.",
  },
];

const features = [
  {
    icon: Link2,
    title: "Short links + UTM builder",
    body: "Turn unreadable URLs into short links, with a built-in UTM builder that also reads parameters already in the URL you paste. On every plan.",
  },
  {
    icon: QrCode,
    title: "Branded QR codes",
    body: "One click turns any link into a QR code with your logo, colors, and dot styles baked in. Set org-wide defaults, override per link, and print it anywhere.",
    plan: "Paid",
  },
  {
    icon: Globe,
    title: "Custom domains & slugs",
    body: "Serve short links from your own domain with automatic TLS and any slug you like, so every click reinforces your brand, not ours.",
    plan: "Paid",
  },
  {
    icon: Users,
    title: "Organizations & roles",
    body: "Owner, admin, and member roles control who can edit links, connect domains, and invite people.",
  },
  {
    icon: BarChart3,
    title: "Click analytics",
    body: "Zoom from the last 24 hours to a full year, compare any period with the one before, and spot your busiest hours on the heatmap.",
  },
  {
    icon: Target,
    title: "Campaign tracking",
    body: "UTM campaigns, sources, and mediums ranked by clicks, so you can see which channel earns its keep.",
  },
  {
    icon: TrendingDown,
    title: "Link health",
    body: "rdyrct flags links that go quiet: zero clicks in 30 days, or a drop of more than half week over week.",
  },
  {
    icon: Activity,
    title: "Live click feed",
    body: "A feed of the latest clicks sits on your dashboard and refreshes on its own: slug, referrer, country, and device.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-friendly",
    body: "No IP addresses, no precise location, no cross-site tracking. Analytics your legal team can sign off on.",
  },
];

const faqs = [
  {
    q: "Is the free plan really free?",
    a: `Yes: ${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.members} teammates, and ${PLAN_LIMITS.free.analyticsDays} days of click analytics, forever. No credit card required. Shared-domain links get random slugs; picking your own slug needs a custom domain (paid plans).`,
  },
  {
    q: "What's the difference between Hobby and Pro?",
    a: `Hobby (${PLAN_PRICES.hobby}/mo) unlocks branded QR codes, a custom domain with your own slugs, ${PLAN_LIMITS.hobby.links} links, ${PLAN_LIMITS.hobby.members} team members, and ${PLAN_LIMITS.hobby.analyticsDays}-day analytics for one organization. Pro (${PLAN_PRICES.pro}/mo) raises everything: ${PLAN_LIMITS.pro.orgs} organizations, ${PLAN_LIMITS.pro.links.toLocaleString()} links, ${PLAN_LIMITS.pro.members} team members, ${PLAN_LIMITS.pro.domains} custom domains each, ${PLAN_LIMITS.pro.analyticsDays}-day analytics, and direct email support. Only the organization owner needs a paid plan: one subscription covers every organization they own.`,
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
    q: "Can I self-host instead?",
    a: "Yes. rdyrct is open source and deploys to your own Cloudflare account. You get everything Pro has, minus direct email support.",
  },
];

function Section({ children, className = "py-16", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <m.section
      id={id}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={className}
    >
      {children}
    </m.section>
  );
}

/** FAQPage structured data, generated from the same `faqs` the page renders. */
function FaqJsonLd() {
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
    // "</script>" inside a value would end the tag early; escape every "<"
  }).replace(/</g, "\\u003c");
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
  );
}

type Tier = "self" | "free" | "hobby" | "pro";

function Cell({ tier, children }: { tier?: Tier; children?: ReactNode }) {
  return (
    <Td
      className={
        tier === "pro" ? "border-x border-x-accent/25 bg-accent/5" : undefined
      }
    >
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
function usePaidPlanTo() {
  const me = useCurrentUser();
  return (plan: "hobby" | "pro") =>
    me.data
      ? `/billing?plan=${plan}`
      : `/signup?next=${encodeURIComponent(`/billing?plan=${plan}`)}`;
}

/** Stacked plan cards for phones, where the comparison table can't breathe. */
function MobilePlans({ paidTo }: { paidTo: (p: "hobby" | "pro") => string }) {
  const tiers = [
    {
      name: "Free",
      tagline: "For side projects",
      price: "$0",
      features: [
        `${PLAN_LIMITS.free.links} links`,
        `${PLAN_LIMITS.free.members} team members`,
        `${PLAN_LIMITS.free.analyticsDays}-day click analytics`,
        "Random slugs on the shared domain",
      ],
      cta: (
        <Link to="/signup">
          <Button variant="outline" size="sm" className="w-full">
            Sign up free
          </Button>
        </Link>
      ),
    },
    {
      name: "Hobby",
      tagline: "For creators & solo brands",
      price: `${PLAN_PRICES.hobby}/mo`,
      features: [
        `${PLAN_LIMITS.hobby.links} links`,
        `${PLAN_LIMITS.hobby.members} team members`,
        `${PLAN_LIMITS.hobby.domains} custom domain with your own slugs`,
        "QR codes",
        `${PLAN_LIMITS.hobby.analyticsDays}-day click analytics`,
      ],
      cta: (
        <Link to={paidTo("hobby")}>
          <Button variant="outline" size="sm" className="w-full">
            Start Hobby
          </Button>
        </Link>
      ),
    },
    {
      name: "Pro",
      tagline: "For brands & growing teams",
      price: `${PLAN_PRICES.pro}/mo`,
      highlight: true,
      features: [
        `${PLAN_LIMITS.pro.orgs} organizations (only the owner pays)`,
        `${PLAN_LIMITS.pro.links.toLocaleString()} links`,
        `${PLAN_LIMITS.pro.members} team members`,
        `${PLAN_LIMITS.pro.domains} custom domains each`,
        `${PLAN_LIMITS.pro.analyticsDays}-day click analytics`,
        "Direct email support",
      ],
      cta: (
        <Link to={paidTo("pro")}>
          <Button variant="primary" size="sm" className="w-full">
            Start Pro
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 sm:hidden">
      {tiers.map(({ name, tagline, price, features, cta, highlight }) => (
        <div
          key={name}
          className={cn(
            "rounded-lg border p-4",
            highlight
              ? "border-accent/40 bg-accent/5"
              : "border-border bg-surface",
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className={highlight ? "font-bold text-accent" : "font-bold"}>
                {name}
                {highlight && (
                  <span className="ml-2 rounded-full border border-accent/40 px-2 py-0.5 text-3xs tracking-wide text-accent uppercase">
                    Most popular
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">{tagline}</p>
            </div>
            <p className="tnum text-base font-bold">{price}</p>
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

/** Four-tier comparison table (self-hosted / Free / Hobby / Pro). */
function PricingSection() {
  const paidTo = usePaidPlanTo();
  return (
    <Section id="pricing" className="scroll-mt-16 py-16">
      <div className="mb-8 text-center">
        <h2 className="text-xl font-bold">Simple pricing</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
          Start free. Upgrade when your links outgrow the plan, or self-host
          and never pay us a cent.
        </p>
      </div>

      <MobilePlans paidTo={paidTo} />

      <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              <Th></Th>
              <Th>
                Self-hosted
                <span className="mt-0.5 block normal-case tracking-normal text-muted/80">
                  Full control, your infra
                </span>
              </Th>
              <Th>
                Free
                <span className="mt-0.5 block normal-case tracking-normal text-muted/80">
                  For side projects
                </span>
              </Th>
              <Th>
                Hobby
                <span className="mt-0.5 block normal-case tracking-normal text-muted/80">
                  For creators & solo brands
                </span>
              </Th>
              <Th className="border-x border-x-accent/25 bg-accent/10">
                <span className="inline-flex items-center gap-2 text-accent">
                  Pro
                  <span className="rounded-full border border-accent/40 px-2 py-0.5 text-3xs tracking-wide text-accent uppercase">
                    Most popular
                  </span>
                </span>
                <span className="mt-0.5 block normal-case tracking-normal text-accent/80">
                  For brands & growing teams
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td className="font-bold">Price</Td>
              <Td>Free · open source</Td>
              <Td>$0</Td>
              <Td>
                <span className="text-base font-bold">
                  {PLAN_PRICES.hobby}/mo
                </span>
              </Td>
              <Cell tier="pro">
                <span className="text-base font-bold text-accent">
                  {PLAN_PRICES.pro}/mo
                </span>
                <span className="block text-2xs font-normal text-muted">
                  only the org owner pays
                </span>
              </Cell>
            </tr>
            <tr>
              <Td className="font-bold">Hosting</Td>
              <Td>Your own Cloudflare</Td>
              <Td>Hosted on rdyrct.com</Td>
              <Td>Hosted on rdyrct.com</Td>
              <Cell tier="pro">Hosted on rdyrct.com</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Organizations</Td>
              <Td>Unlimited</Td>
              <Td>{PLAN_LIMITS.free.orgs}</Td>
              <Td>{PLAN_LIMITS.hobby.orgs}</Td>
              <Cell tier="pro">{PLAN_LIMITS.pro.orgs}</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Links</Td>
              <Td>Unlimited</Td>
              <Td>{PLAN_LIMITS.free.links}</Td>
              <Td>{PLAN_LIMITS.hobby.links}</Td>
              <Cell tier="pro">{PLAN_LIMITS.pro.links.toLocaleString()}</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Custom slugs</Td>
              <YesCell />
              <Td className="text-muted">Random only</Td>
              <Td>On your domain</Td>
              <Cell tier="pro">On your domains</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Team members</Td>
              <Td>Unlimited</Td>
              <Td>{PLAN_LIMITS.free.members}</Td>
              <Td>{PLAN_LIMITS.hobby.members}</Td>
              <Cell tier="pro">{PLAN_LIMITS.pro.members}</Cell>
            </tr>
            <tr>
              <Td className="font-bold">QR codes</Td>
              <YesCell />
              <NoCell />
              <YesCell />
              <YesCell tier="pro" />
            </tr>
            <tr>
              <Td className="font-bold">Custom domains</Td>
              <Td>Unlimited (your Cloudflare)</Td>
              <Td className="text-muted">No</Td>
              <Td>{PLAN_LIMITS.hobby.domains}</Td>
              <Cell tier="pro">{PLAN_LIMITS.pro.domains}</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Analytics history</Td>
              <Td>Unlimited</Td>
              <Td>{PLAN_LIMITS.free.analyticsDays} days</Td>
              <Td>{PLAN_LIMITS.hobby.analyticsDays} days</Td>
              <Cell tier="pro">{PLAN_LIMITS.pro.analyticsDays} days</Cell>
            </tr>
            <tr>
              <Td className="font-bold">Support</Td>
              <Td>GitHub issues</Td>
              <Td>GitHub issues</Td>
              <Td>GitHub issues</Td>
              <Cell tier="pro">Direct email support</Cell>
            </tr>
            <tr>
              <Td />
              <Td>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="w-full">
                    View on GitHub
                  </Button>
                </a>
              </Td>
              <Td>
                <Link to="/signup">
                  <Button variant="outline" size="sm" className="w-full">
                    Sign up free
                  </Button>
                </Link>
              </Td>
              <Td>
                <Link to={paidTo("hobby")}>
                  <Button variant="outline" size="sm" className="w-full">
                    Start Hobby
                  </Button>
                </Link>
              </Td>
              <Cell tier="pro">
                <Link to={paidTo("pro")}>
                  <Button variant="primary" size="sm" className="w-full">
                    Start Pro
                  </Button>
                </Link>
              </Cell>
            </tr>
          </tbody>
        </Table>
      </div>
    </Section>
  );
}

/* ---------------- Fake deploy terminal ---------------- */

const resources = [
  {
    name: "KV",
    id: "rdyrct-redirects",
    desc: "Slug cache on the redirect hot path. Reads never touch the database.",
  },
  {
    name: "D1",
    id: "rdyrct",
    desc: "Source of truth for links, organizations, members, and click analytics.",
  },
  {
    name: "R2",
    id: "rdyrct-qr-logos",
    desc: "QR logo images, uploaded and served through the Worker.",
  },
  {
    name: "Worker",
    id: "rdyrct",
    desc: "Routing, redirects, and API at the edge, nearest data center.",
  },
  {
    name: "Cloudflare for SaaS",
    id: "*.yourdomain.co",
    desc: "TLS terminated automatically on every custom domain.",
  },
];

const delays = [
  0.2, // prompt
  0.7, // build
  1.2, // upload
  1.7, // deploy
  2.2, // blank
  2.4, // header
  2.8, // kv
  3.2, // d1
  3.6, // r2
  4.0, // worker
  4.4, // saas
  4.8, // summary blank
  5.0, // summary
];

const lineVariant: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, delay, ease: "easeOut" },
  }),
};

/**
 * A fake "bun run deploy" terminal that, when scrolled into view, walks
 * through building, uploading, and deploying the Worker, then explains each
 * Cloudflare primitive that was deployed.
 */
function DeployTerminal() {
  const reduce = useReducedMotion();
  const animated = !reduce;

  const cursor = animated ? (
    <span
      aria-hidden
      className="inline-block h-[13px] w-[5px] translate-y-px bg-accent align-middle ml-0.5"
      style={{ animation: "cursorBlink 1s step-end infinite" }}
    />
  ) : null;

  const lines = [
    /* 0 */ <span key="prompt"><span className="text-accent/70">$</span> bun run deploy{cursor}</span>,
    /* 1 */ <span key="build"><span className="text-[#27c93f]">✓</span> src/worker/index.ts → dist/worker.js  <span className="text-muted/50">(2.4s)</span></span>,
    /* 2 */ <span key="upload"><span className="text-[#27c93f]">✓</span> Optimizing bundle... <span className="text-muted/50">124 kB gzipped</span></span>,
    /* 3 */ <span key="deploy"><span className="text-[#27c93f]">✓</span> Deploying to Cloudflare global network</span>,
    /* 4 */ <span key="b1" />,
    /* 5 */ <span key="header"><span className="text-muted/50">Deployed resources:</span></span>,
    /* 6-10 */ ...resources.map((r) => (
    <span key={r.name}>
      <span className="text-accent font-semibold">{r.name}</span>
      <span className="text-muted/40">  {r.id}</span>
      <span className="text-muted/20">  —  </span>
      <span className="text-muted">{r.desc}</span>
    </span>
  )),
    /* 11 */ <span key="b2" />,
    /* 12 */ <span key="summary"><span className="text-accent/85">Deployed to prod.</span> <span className="text-muted/50">330+ cities · 5 primitives</span></span>,
  ];

  const content = animated ? (
    <m.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
    >
      {lines.map((node, i) => (
        <m.div
          key={node.key as string}
          variants={lineVariant}
          custom={delays[i]}
          className={i === 4 || i === 11 ? "h-2" : "whitespace-pre-wrap leading-[1.9]"}
        >
          {node}
        </m.div>
      ))}
    </m.div>
  ) : (
    <div>{lines.map((node, i) => <div key={node.key as string} className={i === 4 || i === 11 ? "h-2" : "whitespace-pre-wrap leading-[1.9]"}>{node}</div>)}</div>
  );

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface shadow-lg shadow-black/20">
      <div className="flex items-center border-b border-border bg-surface-2 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#ff5f56]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#ffbd2e]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#27c93f]" />
        </div>
        <span className="flex-1 text-center font-mono text-[0.7rem] text-muted/60">rdyrct deploy</span>
        <div className="invisible flex items-center gap-1.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#ff5f56]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#ffbd2e]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#27c93f]" />
        </div>
      </div>
      <div className="px-4 py-3 font-mono text-[0.78rem]">
        {content}
      </div>
    </div>
  );
}

export function LandingPage() {
  const me = useCurrentUser();
  // While the /user query is in flight, fall back to the last known auth
  // state so a signed-in visitor doesn't see "Sign up" flash before the
  // header settles. Snapshot once: mid-visit flips come from the query.
  const [authHint] = useState(readAuthHint);
  const authed = me.isPending ? authHint : !!me.data;
  const ctaTo = authed ? "/dashboard" : "/signup";
  const ctaLabel = authed ? "Open dashboard" : "Get started free";

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <FaqJsonLd />
          <style>{`@keyframes cursorBlink { 50% { opacity: 0; } }`}</style>
          {/* soft accent glow behind the hero */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px]"
            style={{
              background:
                "radial-gradient(55% 60% at 50% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent)",
            }}
          />

          <header className="sticky top-0 z-20 -mx-6 flex items-center justify-between border-b border-border/50 bg-bg/85 px-6 py-4 backdrop-blur-md">
            <Link to="/" className="text-lg font-bold tracking-widest">
              rdyrct
            </Link>
            <nav className="flex items-center gap-2.5 text-sm sm:gap-4">
              <a href="#pricing" className="text-muted hover:text-accent">
                Pricing
              </a>
              <a href="#faq" className="text-muted hover:text-accent">
                FAQ
              </a>
              {authed ? (
                <Link to="/dashboard">
                  <Button variant="primary">Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link to="/login" className="text-muted hover:text-accent">
                    Log in
                  </Link>
                  <Link to="/signup">
                    <Button variant="primary">Sign up</Button>
                  </Link>
                </>
              )}
            </nav>
          </header>

          <section className="flex flex-col items-center gap-10 py-16 sm:py-20">
            <m.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
                Open source · Runs on Cloudflare's edge
              </span>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
                Short links that carry your brand.
              </h1>
              <p className="max-w-xl text-sm text-muted sm:text-base">
                rdyrct gives your team short links, branded QR codes, and
                custom domains, with privacy-friendly analytics that never
                store an
                IP address. Free to start, open source, and built on
                Cloudflare's global network.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link to={ctaTo}>
                  <Button
                    variant="primary"
                    size="md"
                    className="h-11 px-6 text-base"
                  >
                    {ctaLabel}
                  </Button>
                </Link>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Button
                    variant="outline"
                    size="md"
                    className="h-11 px-6 text-base"
                  >
                    <Code2 size={16} /> Self-host from GitHub
                  </Button>
                </a>
              </div>
              <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted">
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-accent-2" /> Free plan forever
                </li>
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-accent-2" /> No credit card
                  required
                </li>
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-accent-2" /> No IP tracking
                </li>
              </ul>
            </m.div>

            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
              className="flex w-full justify-center"
            >
              <LandingMockup />
            </m.div>
          </section>

          <Section className="py-8">
            <div className="mb-8 text-center">
              <h2 className="text-xl font-bold">
                From paste to published in seconds
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {steps.map(({ title, body }, i) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <span className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent/40 font-mono text-xs font-bold text-accent">
                    {i + 1}
                  </span>
                  <p className="font-bold">{title}</p>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section>
            <div className="mb-8 text-center">
              <h2 className="text-xl font-bold text-balance">
                See every click, respect every visitor
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
                Country, device, referrer, and campaign breakdowns for every
                link, from the last 24 hours to the last year. Never an IP
                address, never cross-site tracking. This is the actual
                analytics page.
              </p>
            </div>
            <div className="flex justify-center">
              <LandingAnalyticsMock />
            </div>
          </Section>

          <Section>
            <div className="mb-8 text-center">
              <h2 className="text-xl font-bold">
                Everything a link needs to earn the click
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
                Built for marketing teams and developers.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {features.map(({ icon: Icon, title, body, plan }) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Icon size={16} className="text-accent" />
                    <p className="font-bold">{title}</p>
                    {plan && (
                      <span className="text-2xs tracking-wide text-muted uppercase">
                        {plan}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section>
            <div className="mb-8 text-center">
              <img src="/cloudflare.svg" alt="Cloudflare" className="mx-auto mb-5 h-10 w-auto" />
              <h2 className="text-xl font-bold">Runs entirely on Cloudflare</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
                No servers to patch, no databases to babysit: rdyrct is built
                from Cloudflare's own primitives, end to end.
              </p>
            </div>
            <DeployTerminal />
          </Section>

          <PricingSection />

          <Section id="faq" className="scroll-mt-16 py-16">
            <div className="mb-8 text-center">
              <h2 className="text-xl font-bold">Frequently asked questions</h2>
            </div>
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {faqs.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-lg border border-border bg-surface px-4 open:border-accent/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-muted transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="pb-4 text-sm text-muted">{a}</p>
                </details>
              ))}
            </div>
          </Section>

          <Section>
            <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-6 py-14 text-center">
              <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
                Start shortening in seconds.
              </h2>
              <p className="max-w-md text-sm text-muted">
                Create your first short link on the free plan. No credit
                card, no visitor tracking, no servers to run.
              </p>
              <Link to={ctaTo}>
                <Button
                  variant="primary"
                  size="md"
                  className="h-11 px-6 text-base"
                >
                  {ctaLabel}
                </Button>
              </Link>
            </div>
          </Section>

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
