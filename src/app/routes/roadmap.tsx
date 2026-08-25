/**
 * The public roadmap.
 *
 * It exists because the landing page claims rdyrct is built for marketing
 * teams *and* developers, and every one of the twelve feature cards under
 * that claim is a marketer's feature: there is no API, no key, no agent
 * access anywhere in the product yet. A developer who reads the claim and
 * finds no evidence has been told something untrue. The honest fix is not to
 * cut the claim, it is to back it.
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
import { Check } from "@/app/ui/icons";
import { useAudience } from "../lib/audience";
import { MarketingPage } from "../components/marketing-page";
import { GITHUB_URL } from "../ui/footer";
import { buttonClass } from "../ui/button-class";
import { HrefLink } from "../lib/router-search";
import { MarketingLink } from "../components/marketing-link";
import type { ReactNode } from "react";

/**
 * Being built next, each one an open issue.
 *
 * Ordered the way the work has to happen, not by how exciting it is: the keys
 * come before the API that checks them, and the MCP server is last because it
 * is a client of everything above it. That ordering is the honest answer to
 * "when do I get the MCP server", and it costs nothing to show.
 */
const PLANNED: { issue: number; title: string; body: ReactNode }[] = [
  {
    issue: 131,
    title: "API keys, scopes and revocation",
    body: "The model underneath everything else here: a key belongs to one organization, carries scopes, and can be killed on the spot.",
  },
  {
    issue: 134,
    title: "API keys in Settings",
    body: "Create and revoke them yourself, with the quota your plan already gives you.",
  },
  {
    issue: 132,
    title: "A public REST API",
    body: "Create, update and read links, QR codes and analytics from your own code.",
  },
  {
    issue: 133,
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
    title: "Rate limits and quotas per key",
    body: "The same caps your plan has today, counted per key, so one runaway script cannot spend the whole organization's budget.",
  },
  {
    issue: 139,
    title: "A remote MCP server",
    body: "Point an agent at it and let it shorten, tag, and read the numbers back, without you writing the glue.",
  },
];

/**
 * What already works, so the page is a roadmap and not a wishlist.
 *
 * A roadmap made only of things that do not exist reads as a product that
 * does not exist. These are one line each and link nowhere: the detail lives
 * on the homepage, and repeating it here would be a second feature grid.
 */
const SHIPPED = [
  "Short links with a built-in UTM builder, on every plan",
  "QR codes on every plan, with your logo and colors on paid ones",
  "Custom domains with automatic TLS, and any slug you like",
  "Click analytics: country, referrer, device, campaign, never an IP address",
  "Organizations, roles, and single-use email invites",
  "Anonymous shortening with no account at all",
  "The whole thing, MIT, running on your own Cloudflare account",
];

function PlannedCard({ issue, title, body }: { issue: number; title: string; body: ReactNode }) {
  return (
    <a
      href={`${GITHUB_URL}/issues/${issue}`}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/40"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold">{title}</p>
        <span className="shrink-0 font-mono text-2xs text-muted">#{issue}</span>
      </div>
      <p className="text-sm text-muted">{body}</p>
    </a>
  );
}

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function RoadmapPage() {
  const { ctaTo, ctaLabel } = useAudience();

  return (
    <MarketingPage
      path="/roadmap"
      title="What we are building"
      intro="rdyrct is built in the open, so this is the work itself rather than a promise about it. Every item below is an issue you can read, argue with, or send a patch to. No dates: one person maintains this, and a date would be a guess dressed up as a commitment."
    >
      <section className="py-12">
        <h2 className="mb-6 text-xl font-bold">Next: the API and agent access</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLANNED.map((item) => (
            <PlannedCard key={item.issue} {...item} />
          ))}
        </div>
        <p className="mt-6 text-sm">
          These hang off one thread,{" "}
          <a
            href={`${GITHUB_URL}/issues/141`}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            make rdyrct usable by an AI agent
          </a>
          , which is where the whole shape gets argued out.
        </p>
      </section>

      <section className="border-t border-border py-12">
        <h2 className="mb-2 text-xl font-bold">Already working</h2>
        <p className="mb-6 max-w-xl text-sm text-muted">
          Everything here is live today, on the free plan unless it says otherwise.
        </p>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {SHIPPED.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted">
              <Check size={15} className="mt-0.5 shrink-0 text-accent-2" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col items-center gap-4 border-t border-border py-12 text-center">
        <h2 className="text-xl font-bold text-balance">Want something that is not here?</h2>
        <p className="max-w-xl text-sm text-muted">
          Open an issue. Requests from people actually using rdyrct are what moves this list, and
          they are read by the person who writes the code.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`${GITHUB_URL}/issues/new`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "outline" })}
          >
            Open an issue
          </a>
          <HrefLink href={ctaTo} className={buttonClass({ variant: "primary" })}>
            {ctaLabel}
          </HrefLink>
        </div>
        <p className="text-xs text-muted">
          Or start with the{" "}
          <MarketingLink to="/pricing" className="text-accent hover:underline">
            plans and prices
          </MarketingLink>
          .
        </p>
      </section>
    </MarketingPage>
  );
}
