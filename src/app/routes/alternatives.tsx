/**
 * The "alternative" pages: /bitly-alternative, /rebrandly-alternative and
 * /short-io-alternative.
 *
 * "X alternative" is how people search once they have outgrown, or been
 * priced out of, X, so each page answers that one question and nothing wider:
 * what it costs at each, where the other tool is the better choice (every page
 * says so, with a reason a reader can check), and where rdyrct is.
 *
 * Every competitor figure is what the vendor's own pricing page stated on
 * CHECKED. Pages disagree with third-party review sites, and with each other
 * from month to month, so recheck before changing a number. Where a page was
 * unclear the row says so rather than guessing. rdyrct's own figures come from
 * PLAN_LIMITS and PLAN_PRICES so they cannot drift from the plans.
 *
 * Three pages sharing one component, not a route with a parameter: each is
 * prerendered at its own path, and a parameterised route cannot be.
 */
import { Link } from "@tanstack/react-router";
import { MarketingPage } from "../components/marketing-page";
import { trackCta } from "../lib/track-cta";
import { formatNumber } from "../lib/numbers";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { Table, Th, Td } from "../ui/misc";

const CHECKED = "October 2026";

const RDYRCT_ROWS = {
  entry: `Hobby, ${PLAN_PRICES.hobby} a month`,
  links: `${formatNumber(PLAN_LIMITS.hobby.links)} active links`,
  domains: `${PLAN_LIMITS.hobby.domains} custom domain`,
  history: `${PLAN_LIMITS.hobby.analyticsDays} days (${PLAN_LIMITS.pro.analyticsDays} on Pro, ${PLAN_PRICES.pro} a month)`,
  free: `${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.analyticsDays} days of analytics, no custom domain`,
};

interface Alternative {
  name: string;
  path: string;
  /** Where the vendor's pricing page lives, for the footnote. */
  pricingUrl: string;
  title: string;
  intro: string;
  answer: string;
  /** What the vendor states for the same five rows as RDYRCT_ROWS. */
  theirs: typeof RDYRCT_ROWS;
  theyWin: string[];
  weWin: string[];
  plans: [plan: string, price: string, includes: string][];
  planNote: string;
  faq: [question: string, answer: string][];
  blog?: { href: string; label: string };
}

const ALTERNATIVES = {
  bitly: {
    name: "Bitly",
    path: "/bitly-alternative",
    pricingUrl: "bitly.com/pages/pricing",
    title: "Bitly alternative: rdyrct vs Bitly",
    intro: "What each costs once you want links on your own domain, and who should stay put.",
    answer: `Bitly's first plan with a custom domain is Growth at $29 a month on annual billing. rdyrct includes one from ${PLAN_PRICES.hobby} a month. If you only need branded links, that is the difference. If you need an enterprise contract, Bitly is the safer pick.`,
    theirs: {
      entry: "Growth, $29 a month (billed annually)",
      links: "500 links a month",
      domains: "1 custom domain",
      history: "4 months (1 year on Premium, $199 a month)",
      free: "5 links and 2 QR codes a month, shown with ads, no custom domain",
    },
    theyWin: [
      "An Enterprise tier with custom pricing and two years of click history, for a company that needs a vendor contract.",
      "Premium allows 3,000 links and 200 QR codes a month, with a year of click data.",
      "It is the best-known name, which matters when a legal or procurement team has to approve the tool.",
    ],
    weWin: [
      `A custom domain from ${PLAN_PRICES.hobby} a month instead of $29, and ${PLAN_LIMITS.pro.domains} domains on Pro for ${PLAN_PRICES.pro}.`,
      "No step from $29 to $199 with nothing in between.",
      "Click analytics that never store a visitor's IP address.",
      "The API and the MCP connector on every plan, and public code you can host yourself.",
    ],
    plans: [
      ["Free", "$0", "5 links, 2 QR codes a month, ads"],
      [
        "Core",
        "$10 a month, annual only",
        "100 links, 5 QR codes, 30 days of data, no custom domain",
      ],
      [
        "Growth",
        "$29 a month, annual",
        "500 links, 10 QR codes, 4 months of data, a custom domain",
      ],
      ["Premium", "$199 a month, annual", "3,000 links, 200 QR codes, 1 year of data"],
      ["Enterprise", "Custom", "Custom limits, 2 years of data"],
    ],
    planNote:
      "Bitly's page showed annual prices only for Growth and Premium, so paying month to month costs more.",
    faq: [
      [
        "How do I move off Bitly without breaking old links?",
        "Links on bit.ly stay with Bitly, so keep that account for as long as they must work. Make new links on your own domain from now on.",
      ],
      [
        "Is rdyrct cheaper than Bitly?",
        `For one custom domain, yes: ${PLAN_PRICES.hobby} a month against $29 a month. Bitly's Free and Core plans cost less but have no custom domain.`,
      ],
      [
        "Does rdyrct have an API?",
        "Yes, on every plan, along with an MCP server for AI assistants.",
      ],
    ],
    blog: { href: "/blog/migrate-from-bitly", label: "How to migrate from Bitly" },
  },
  rebrandly: {
    name: "Rebrandly",
    path: "/rebrandly-alternative",
    pricingUrl: "rebrandly.com/pricing",
    title: "Rebrandly alternative: rdyrct vs Rebrandly",
    intro: "Where each is cheaper, and the one thing Rebrandly gives away that we do not.",
    answer: `Rebrandly's free plan includes a custom domain and ours does not. Past the free plans, rdyrct costs less: one custom domain from ${PLAN_PRICES.hobby} a month, where Rebrandly's Essentials starts at about $11. If you need a domain without paying, use Rebrandly.`,
    theirs: {
      entry: "Free, $0 (Essentials from about $8 to $11 a month)",
      links: "10 links and 10 QR codes a month on Free, 250 on Essentials",
      domains: "1 custom domain on Free, 2 on Essentials",
      history: "Not stated (conversion data kept 6 months on Professional)",
      free: "10 links and 10 QR codes a month, 1 custom domain, watermarked QR codes",
    },
    theyWin: [
      "A custom domain on the free plan, plus a free rebrand.ly domain.",
      "Two custom domains on Essentials, against one on our Hobby.",
      "QR codes counted next to links, with 1,500 of each a month on Professional.",
    ],
    weWin: [
      `Pro costs ${PLAN_PRICES.pro} a month for ${PLAN_LIMITS.pro.domains} domains per organization and ${formatNumber(PLAN_LIMITS.pro.links)} links. Rebrandly's Professional lists 3 domains at $32 or more.`,
      `${PLAN_LIMITS.pro.analyticsDays} days of click history on Pro.`,
      "No watermark on QR codes, and no IP address stored on any click.",
      "Teammates on every plan, from 3 on Free. Rebrandly's Free plan has none.",
    ],
    plans: [
      ["Free", "$0", "10 links and 10 QR codes a month, 1 custom domain, watermark"],
      ["Essentials", "About $8 to $11 a month", "250 links and QR codes, 2 domains"],
      [
        "Professional",
        "About $22 to $32 a month",
        "1,500 links and QR codes, 3 domains, 2+ teammates",
      ],
      [
        "Growth",
        "Higher, several prices listed",
        "3,500 links and QR codes, 10 domains, 1 year of conversion data",
      ],
      ["Enterprise", "Custom quote", "Custom limits, 2 years of conversion data"],
    ],
    planNote:
      "Rebrandly's page lists up to four unlabeled prices per plan, which looks like annual and monthly billing at two volumes. Confirm the cycle on their page.",
    faq: [
      [
        "Does Rebrandly have a free custom domain?",
        "Yes, one on the free plan. rdyrct's free plan has no custom domain: that starts on Hobby.",
      ],
      [
        "Which is better for QR codes?",
        "Rebrandly counts QR codes per month and watermarks them on Free. rdyrct has a free QR generator with no account and no watermark, and logo and color QR codes on paid plans.",
      ],
      [
        "Can I use more than one organization?",
        `Pro includes ${PLAN_LIMITS.pro.orgs} organizations on one subscription. Only the owner pays.`,
      ],
    ],
    blog: { href: "/blog/rebrandly-alternatives", label: "More on Rebrandly alternatives" },
  },
  shortio: {
    name: "Short.io",
    path: "/short-io-alternative",
    pricingUrl: "short.io/pricing",
    title: "Short.io alternative: rdyrct vs Short.io",
    intro: "Short.io is cheaper on raw numbers. Here is when that stops mattering.",
    answer: `Short.io beats us on price and free-plan size: its free plan lists 5 custom domains, and ours lists none. We are the better pick when you care that click analytics never store a visitor's IP address, or want to host the code yourself. For a budget with no other needs, take Short.io.`,
    theirs: {
      entry: "Free, $0 (Hobby $5 a month)",
      links: "1,000 branded links, issued once, on Free",
      domains: "5 custom domains on Free, 7 on Hobby",
      history: "Not stated",
      free: "1,000 branded links, 50,000 tracked clicks a month, 5 custom domains, 1 user",
    },
    theyWin: [
      "A free plan with 5 custom domains and 1,000 branded links.",
      "Hobby at $5 a month for 2,500 links and 100,000 tracked clicks.",
      "Unlimited links and clicks on Pro at $18 a month.",
    ],
    weWin: [
      "Click analytics that never store an IP address: only country, referrer, device and time.",
      "Public code you can deploy to your own Cloudflare account, with no caps.",
      `Team members on every plan (${PLAN_LIMITS.free.members} on Free, ${PLAN_LIMITS.pro.members} on Pro). Short.io's Free, Hobby and Pro plans are one user each.`,
      "The API and the MCP connector on every plan.",
    ],
    plans: [
      ["Free", "$0", "1,000 branded links, 50,000 clicks a month, 5 domains, 1 user"],
      ["Hobby", "$5 a month", "2,500 links, 100,000 clicks a month, 7 domains"],
      ["Pro", "$18 a month", "Unlimited links and clicks, 10 domains, 1 user"],
      ["Team", "$48 a month", "Unlimited links and clicks, 50 domains, unlimited users"],
      ["Enterprise", "$148 a month", "Unlimited domains and users"],
    ],
    planNote:
      "Short.io's table does not say which billing cycle its prices use, and its branded-link allowance is issued once for the life of the account.",
    faq: [
      [
        "Is Short.io's free plan really free?",
        "Its pricing page lists a free plan with no card. After 50,000 tracked clicks in a month, statistics are restricted but existing links keep working.",
      ],
      [
        "Why would I choose rdyrct over a larger free plan?",
        "Mostly for privacy and ownership: no IP addresses stored, and public code you can host yourself.",
      ],
      [
        "Do both let me use my own domain?",
        `Yes. Short.io includes domains on its free plan. rdyrct includes ${PLAN_LIMITS.hobby.domains} from Hobby and ${PLAN_LIMITS.pro.domains} on Pro.`,
      ],
    ],
    blog: { href: "/blog/short-io-alternatives", label: "More on Short.io alternatives" },
  },
} satisfies Record<string, Alternative>;

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-muted marker:text-accent">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function AlternativePage({ data }: { data: Alternative }) {
  const glance = [
    ["Cheapest plan with a custom domain", "entry"],
    ["Links", "links"],
    ["Custom domains", "domains"],
    ["Analytics history", "history"],
    ["Free plan", "free"],
  ] as const;
  return (
    <MarketingPage path={data.path} title={data.title} intro={data.intro}>
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The short answer</h2>
        <p className="text-muted">{data.answer}</p>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">rdyrct and {data.name}</h2>
        <Table minWidth="min-w-xl">
          <thead>
            <tr>
              <Th></Th>
              <Th className="bg-accent/5">rdyrct</Th>
              <Th>{data.name}</Th>
            </tr>
          </thead>
          <tbody>
            {glance.map(([label, key]) => (
              <tr key={key}>
                <Td className="font-bold">{label}</Td>
                <Td className="bg-accent/5">{RDYRCT_ROWS[key]}</Td>
                <Td className="text-muted">{data.theirs[key]}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs text-muted">
          {data.name} figures from {data.pricingUrl}, {CHECKED}. rdyrct figures from our pricing
          page.
        </p>
      </section>

      <section className="grid gap-10 pb-12 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">
            Where {data.name} is the better choice
          </h2>
          <BulletList items={data.theyWin} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">Where rdyrct is the better choice</h2>
          <BulletList items={data.weWin} />
        </div>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{data.name} plans</h2>
        <Table minWidth="min-w-xl">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Price</Th>
              <Th>What it includes</Th>
            </tr>
          </thead>
          <tbody>
            {data.plans.map(([plan, price, includes]) => (
              <tr key={plan}>
                <Td className="font-bold">{plan}</Td>
                <Td className="tnum whitespace-nowrap">{price}</Td>
                <Td className="text-muted">{includes}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs text-muted">{data.planNote}</p>
      </section>

      <section className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Questions</h2>
        {data.faq.map(([question, answer]) => (
          <div key={question}>
            <h3 className="font-bold">{question}</h3>
            <p className="mt-1 text-muted">{answer}</p>
          </div>
        ))}
        {data.blog && (
          <p className="text-sm">
            <a href={data.blog.href} className="text-accent hover:underline">
              {data.blog.label}
            </a>
          </p>
        )}
      </section>

      <section className="flex flex-col items-start gap-4 border-t border-border py-16">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Try it free. Move over when you are ready.
        </h2>
        <Link
          to="/signup"
          onClick={() => trackCta("alternative_page_signup")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          Sign up free
        </Link>
        <p className="text-xs text-muted">
          No credit card. Every plan is on our{" "}
          <Link to="/pricing" className="text-accent hover:underline">
            pricing page
          </Link>
          .
        </p>
      </section>
    </MarketingPage>
  );
}

// main.tsx names these exports as strings, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function BitlyAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.bitly} />;
}
// fallow-ignore-next-line unused-export
export function RebrandlyAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.rebrandly} />;
}
// fallow-ignore-next-line unused-export
export function ShortIoAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.shortio} />;
}
