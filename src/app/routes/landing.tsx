import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Link2,
  QrCode,
  Globe,
  Users,
  BarChart3,
  ShieldCheck,
  Server,
  Database,
  Zap,
  Check,
  Code2,
  ChevronDown,
} from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useMe } from "../lib/hooks";
import { PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Table, Th, Td } from "../ui/misc";
import { Footer, GITHUB_URL } from "../ui/footer";
import { LandingMockup } from "../components/landing-mockup";

// TODO: owner to confirm final monthly price
const PRO_PRICE = "$5";

const steps = [
  {
    title: "Paste your URL",
    body: "Drop in any long link, give it a memorable slug, and tag it with the built-in UTM builder.",
  },
  {
    title: "Share it anywhere",
    body: "Use it as a short link or a scannable QR code, served from our domain or your own.",
  },
  {
    title: "Watch clicks roll in",
    body: "Country, referrer, and device breakdowns update in real time — without storing a single IP.",
  },
];

const features = [
  {
    icon: Link2,
    title: "Custom slugs + UTM",
    body: "Turn unreadable URLs into memorable, on-brand slugs, with a built-in UTM builder for clean campaign tracking.",
  },
  {
    icon: QrCode,
    title: "QR codes",
    body: "One click turns any link into a scannable QR code, ready for packaging, posters, and slides.",
    pro: true,
  },
  {
    icon: Globe,
    title: "Custom domains",
    body: "Serve short links from your own domain with automatic TLS, so every click reinforces your brand, not ours.",
    pro: true,
  },
  {
    icon: Users,
    title: "Organizations & roles",
    body: "Owner, admin, and member roles keep the whole team organized across shared workspaces.",
  },
  {
    icon: BarChart3,
    title: "Click analytics",
    body: "See what's working the moment it happens: country, referrer, and device breakdowns for every link.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy-friendly",
    body: "No IP addresses, no precise location, no cross-site tracking. Analytics your legal team can sign off on.",
  },
];

const cloudflareStack = [
  {
    icon: Server,
    title: "Workers",
    body: "Compute and routing at the edge. Every redirect and API call runs on Cloudflare's global network.",
  },
  {
    icon: Database,
    title: "D1",
    body: "Links, organizations, and members live in Cloudflare's managed SQLite database.",
  },
  {
    icon: Zap,
    title: "KV",
    body: "The redirect hot path reads from Workers KV, so short links resolve in milliseconds.",
  },
  {
    icon: Globe,
    title: "Cloudflare for SaaS",
    body: "Custom domains are provisioned and TLS-terminated automatically, no extra infra to run.",
  },
];

const faqs = [
  {
    q: "Is the free plan really free?",
    a: `Yes — ${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.members} teammates, and ${PLAN_LIMITS.free.analyticsDays} days of click analytics, forever. No credit card required. Upgrade only if you outgrow it.`,
  },
  {
    q: "What does Pro add?",
    a: `QR codes, ${PLAN_LIMITS.pro.domains} custom domains, ${PLAN_LIMITS.pro.links.toLocaleString()} links, ${PLAN_LIMITS.pro.members} team members, ${PLAN_LIMITS.pro.analyticsDays}-day analytics, and direct email support. Only the organization owner needs Pro — one subscription covers every organization they own.`,
  },
  {
    q: "How is rdyrct privacy-friendly?",
    a: "Click analytics store only a country, referrer, device type, and timestamp — never an IP address, never a precise location, and no cross-site tracking.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Pro includes custom domains with automatic TLS through Cloudflare for SaaS: point your DNS at us and short links go live under your brand.",
  },
  {
    q: "Can I self-host instead?",
    a: "Yes — rdyrct is open source and deploys to your own Cloudflare account. You get everything Pro has, minus direct email support.",
  },
];

type Tier = "self" | "free" | "pro";

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

export function LandingPage() {
  const me = useMe();
  const ctaTo = me.data ? "/dashboard" : "/signup";
  const ctaLabel = me.data ? "Open dashboard" : "Get started free";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
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
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="#pricing"
              className="hidden text-muted hover:text-accent sm:inline"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="hidden text-muted hover:text-accent sm:inline"
            >
              FAQ
            </a>
            {me.data ? (
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
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-6 text-center"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
              Open source · Runs on Cloudflare's edge
            </span>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
              Short links that carry your brand.
            </h1>
            <p className="max-w-xl text-sm text-muted sm:text-base">
              rdyrct gives your team branded short links, QR codes, and
              custom domains — with privacy-friendly analytics that never
              store an IP address. Free to start, open source, and resolving
              in milliseconds on Cloudflare's global network.
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
            className="flex w-full justify-center"
          >
            <LandingMockup />
          </motion.div>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="py-8"
        >
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
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="py-16"
        >
          <div className="mb-8 text-center">
            <h2 className="text-xl font-bold">
              Everything a link needs to earn the click
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              Built for marketing teams, developers, and everyone in between.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body, pro }) => (
              <div
                key={title}
                className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon size={16} className="text-accent" />
                  <p className="font-bold">{title}</p>
                  {pro && (
                    <span className="text-[11px] tracking-wide text-muted uppercase">
                      Pro
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="py-16"
        >
          <div className="mb-8 text-center">
            <h2 className="text-xl font-bold">Runs entirely on Cloudflare</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              No servers to patch, no databases to babysit. rdyrct is built
              from Cloudflare's own primitives, end to end — so your links
              resolve in milliseconds, anywhere on Earth.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cloudflareStack.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <Icon size={18} className="mb-2 text-accent" />
                <p className="font-bold">{title}</p>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section
          id="pricing"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="scroll-mt-16 py-16"
        >
          <div className="mb-8 text-center">
            <h2 className="text-xl font-bold">Simple pricing</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              Start free. Upgrade when your links outgrow the plan — or
              self-host and never pay us a cent.
            </p>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Plan</Th>
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
                <Th className="border-x border-x-accent/25 bg-accent/10">
                  <span className="inline-flex items-center gap-2 text-accent">
                    Pro
                    <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] tracking-wide text-accent uppercase">
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
                <Cell tier="pro">
                  <span className="text-base font-bold text-accent">
                    {PRO_PRICE}/mo
                  </span>
                  <span className="block text-[11px] font-normal text-muted">
                    only the org owner pays
                  </span>
                </Cell>
              </tr>
              <tr>
                <Td className="font-bold">Hosting</Td>
                <Td>Your own Cloudflare</Td>
                <Td>Hosted on rdyrct.com</Td>
                <Cell tier="pro">Hosted on rdyrct.com</Cell>
              </tr>
              <tr>
                <Td className="font-bold">Organizations</Td>
                <Td>Unlimited</Td>
                <Td>{PLAN_LIMITS.free.orgs}</Td>
                <Cell tier="pro">{PLAN_LIMITS.pro.orgs}</Cell>
              </tr>
              <tr>
                <Td className="font-bold">Links</Td>
                <Td>Unlimited</Td>
                <Td>{PLAN_LIMITS.free.links}</Td>
                <Cell tier="pro">{PLAN_LIMITS.pro.links.toLocaleString()}</Cell>
              </tr>
              <tr>
                <Td className="font-bold">Team members</Td>
                <Td>Unlimited</Td>
                <Td>{PLAN_LIMITS.free.members}</Td>
                <Cell tier="pro">{PLAN_LIMITS.pro.members}</Cell>
              </tr>
              <tr>
                <Td className="font-bold">QR codes</Td>
                <YesCell />
                <NoCell />
                <YesCell tier="pro" />
              </tr>
              <tr>
                <Td className="font-bold">Custom domains</Td>
                <Td>Unlimited (your Cloudflare)</Td>
                <Td className="text-muted">No</Td>
                <Cell tier="pro">{PLAN_LIMITS.pro.domains}</Cell>
              </tr>
              <tr>
                <Td className="font-bold">Analytics history</Td>
                <Td>Unlimited</Td>
                <Td>{PLAN_LIMITS.free.analyticsDays} days</Td>
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
                <Cell tier="pro">
                  <Link to="/signup">
                    <Button variant="primary" size="sm" className="w-full">
                      Start Pro
                    </Button>
                  </Link>
                </Cell>
              </tr>
            </tbody>
          </Table>
        </motion.section>

        <motion.section
          id="faq"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="scroll-mt-16 py-16"
        >
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
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="py-16"
        >
          <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-6 py-14 text-center">
            <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
              Start shortening in seconds.
            </h2>
            <p className="max-w-md text-sm text-muted">
              Create your first branded link on the free plan — no credit
              card, no tracking baggage, no servers to run.
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
        </motion.section>

        <Footer />
      </div>
    </MotionConfig>
  );
}
