/**
 * The public roadmap.
 *
 * It exists because the landing page claims rdyrct is built for marketing
 * teams *and* developers, and most of the twelve feature cards under that
 * claim are a marketer's feature. API keys, a scoped REST API and a remote
 * MCP server (#131, #132, #139) back the developer half now; what is left
 * here is what still makes that story incomplete.
 *
 * Laid out as a board, the way the public roadmaps worth copying are: a
 * column per stage, each saying what the stage means and how much is in it,
 * and one card per item tagged with the part of the product it touches.
 *
 * Every planned item is a real open issue, linked. No dates: a date is what
 * turns a roadmap into a liability, and this one is maintained by one person.
 * The issue is the promise, and anybody can go read it, argue with it, or
 * send the patch themselves.
 *
 * A page rather than a band on the homepage, for the same reason /pricing is
 * a page: somebody looking for it is looking for it on purpose, a search
 * result can deep-link a page and not a scroll position, and the homepage
 * already runs long enough that a ninth section costs more than it returns.
 */
import type { ComponentType, ReactNode } from "react";
import { ArrowUpRight, Check, Clock, Lightbulb } from "@/app/ui/icons";
import { useAudience } from "../lib/audience";
import { MarketingPage } from "../components/marketing-page";
import { FrameRow, SplitHeading } from "../components/marketing-kit";
import { GITHUB_URL } from "../ui/footer";
import { buttonClass } from "../ui/button-class";
import { HrefLink } from "../lib/router-search";
import { MarketingLink } from "../components/marketing-link";

type Item = { issue?: number; area: string; title: string; body?: ReactNode };

/** Being built next, each one an open issue. */
const NEXT: Item[] = [
  {
    issue: 75,
    area: "Links",
    title: "Bulk link export",
    body: "Take every link out in one CSV, ready for a spreadsheet or another service.",
  },
  {
    issue: 77,
    area: "Links",
    title: "Password-protected and targeted links",
    body: "Gate a link with a password, or send visitors to different destinations by country or device.",
  },
  {
    issue: 133,
    area: "API",
    title: "An OpenAPI document",
    // The path is an identifier, so it takes the mono face, same rule as a
    // slug. Everything around it is prose and stays in the sans.
    body: (
      <>
        Served at <span className="font-mono">/openapi.json</span>, so a client generates itself
        instead of being written by hand.
      </>
    ),
  },
  {
    issue: 135,
    area: "API",
    title: "Rate limits and quotas per key",
    body: "The same caps your plan has today, counted per key, so one runaway script cannot spend the whole organization's budget.",
  },
  {
    issue: 136,
    area: "Agents",
    title: "A machine-readable API catalog",
    body: (
      <>
        Served at <span className="font-mono">/.well-known/api-catalog</span>, so an agent finds the
        API without being told where to look.
      </>
    ),
  },
  {
    issue: 138,
    area: "Agents",
    title: "A registration doc for agents",
    body: (
      <>
        <span className="font-mono">/auth.md</span> spells out how an agent signs itself up for API
        access, in the format agents are starting to expect.
      </>
    ),
  },
];

/** Wanted and written up, not started. */
const LATER: Item[] = [
  {
    issue: 254,
    area: "Analytics",
    title: "The period before, on the chart",
    body: "The last 30 days drawn over the 30 before them, so a change shows without arithmetic.",
  },
  {
    issue: 257,
    area: "Links",
    title: "Clicks on links made without an account",
    body: "Counted from the start, and shown once you sign up.",
  },
  {
    issue: 256,
    area: "Analytics",
    title: "Your first click, live",
    body: "Scan your new link's QR code and watch the click arrive.",
  },
  {
    issue: 259,
    area: "Email",
    title: "A first-click email and a monthly summary",
    body: "Only for people who ask for them.",
  },
  {
    issue: 326,
    area: "Tools",
    title: "A free redirect checker and UTM builder",
    body: "Two more tools that need no account, like the QR generator.",
  },
];

/**
 * What already works, so the page is a roadmap and not a wishlist.
 *
 * A roadmap made only of things that do not exist reads as a product that
 * does not exist. One line each and no link: the detail lives on the
 * homepage, and repeating it here would be a second feature grid.
 */
const SHIPPED: Item[] = [
  { area: "Links", title: "Short links with a built-in UTM builder, on every plan" },
  { area: "Links", title: "Custom domains with automatic TLS, and any slug you like" },
  { area: "Links", title: "A second short domain, rdyr.cc, for new links" },
  { area: "Links", title: "Anonymous shortening with no account at all" },
  {
    area: "Links",
    title: "Import from Bitly, Short.io, Rebrandly or Dub, with the same short URLs",
  },
  { area: "QR", title: "QR codes on every plan, with your logo and colours on paid ones" },
  { area: "Analytics", title: "Country, referrer, device and campaign, never an IP address" },
  { area: "Teams", title: "Organizations, roles, and single-use email invites" },
  { area: "API", title: "API keys, a scoped REST API, and an MCP server with OAuth sign-in" },
  { area: "Self-hosting", title: "The whole thing, MIT, on your own Cloudflare account" },
];

type Stage = {
  name: string;
  meaning: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  items: Item[];
};

const STAGES: Stage[] = [
  { name: "Next", meaning: "Planned, each an open issue.", icon: Clock, items: NEXT },
  { name: "Later", meaning: "Written up, not started.", icon: Lightbulb, items: LATER },
  {
    name: "Shipped",
    meaning: "Live today, on the free plan unless it says otherwise.",
    icon: Check,
    items: SHIPPED,
  },
];

function Area({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs whitespace-nowrap text-muted">
      {children}
    </span>
  );
}

/** A planned item: the whole card is the link to its issue. */
function IssueCard({ issue, area, title, body }: Item) {
  return (
    <a
      href={`${GITHUB_URL}/issues/${issue}`}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-1.5 rounded-xl border border-border/70 bg-surface p-4 transition-colors hover:border-accent/50 focus-visible:border-accent/50"
    >
      <p className="font-bold text-pretty text-text">{title}</p>
      {body && <p className="text-sm text-pretty text-muted">{body}</p>}
      <p className="mt-1.5 flex items-center gap-2">
        <Area>{area}</Area>
        <span className="ml-auto flex items-center gap-0.5 font-mono text-xs text-muted transition-colors group-hover:text-accent">
          #{issue}
          <ArrowUpRight size={13} />
        </span>
      </p>
    </a>
  );
}

/** A shipped item: one line, a tick, its area. */
function ShippedRow({ area, title }: Item) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-surface px-4 py-3 text-sm">
      <Check size={15} className="mt-0.5 shrink-0 text-accent-2" />
      <span className="flex-1 text-pretty">{title}</span>
      <Area>{area}</Area>
    </div>
  );
}

function Column({ name, meaning, icon: Icon, items }: Stage) {
  const id = `stage-${name.toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col rounded-2xl border border-border/70 bg-surface-2"
    >
      <header className="border-b border-border/70 px-4 pt-4 pb-3">
        <h2 id={id} className="flex items-center gap-2 font-bold">
          <Icon size={17} className="text-accent" />
          {name}
          <span className="tnum rounded-full bg-surface px-2 text-xs font-normal text-muted">
            {items.length}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted">{meaning}</p>
      </header>
      <ul className="flex flex-col gap-2 p-2">
        {items.map((item) => (
          <li key={item.title}>
            {item.issue ? <IssueCard {...item} /> : <ShippedRow {...item} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RoadmapPage() {
  const { ctaTo, ctaLabel } = useAudience();

  return (
    <MarketingPage
      path="/roadmap"
      title="What we are building"
      intro="rdyrct is built in the open. Every planned item is an issue you can read, argue with, or send a patch to. No dates: one person maintains this, so any date would be a guess."
    >
      {/* The hero closes its own frame; this one starts on the same line. */}
      <div className="-mt-px mb-16 border-x border-border/70">
        <FrameRow className="p-4 sm:p-6">
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {STAGES.map((stage) => (
              <Column key={stage.name} {...stage} />
            ))}
          </div>
        </FrameRow>
        <FrameRow className="flex flex-col gap-6 px-6 py-12 sm:px-10 md:flex-row md:items-end md:justify-between md:py-16">
          <div>
            <SplitHeading
              className="text-2xl sm:text-3xl"
              lead="Want something that is not here?"
              rest="Open an issue. The person who writes the code reads every one."
            />
            <p className="mt-4 text-sm text-muted">
              Or start with the{" "}
              <MarketingLink to="/pricing" className="text-accent hover:underline">
                plans and prices
              </MarketingLink>
              .
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <a
              href={`${GITHUB_URL}/issues/new`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "outline", className: "rounded-full px-4" })}
            >
              Open an issue
            </a>
            <HrefLink
              href={ctaTo}
              className={buttonClass({ variant: "primary", className: "rounded-full px-4" })}
            >
              {ctaLabel}
            </HrefLink>
          </div>
        </FrameRow>
        <FrameRow />
      </div>
    </MarketingPage>
  );
}
