/**
 * The "alternative" pages: /bitly-alternative, /rebrandly-alternative,
 * /dub-alternative, /short-io-alternative and /tinyurl-alternative.
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
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MarketingPage } from "../components/marketing-page";
import { MarketingLink } from "../components/marketing-link";
import { trackCta } from "../lib/track-cta";
import { formatNumber } from "../lib/numbers";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { SUPPORT_EMAIL } from "../ui/footer";
import { Table, Th, Td } from "../ui/misc";

/** The comparison tables, lit like every product panel on these pages. */
const LIT_TABLE = "lit rounded-3xl border border-border";
import { ArrowRight } from "../ui/icons";

const CHECKED = "October 2026";

const RDYRCT_PRICE_LINE = `Free, or ${PLAN_PRICES.hobby} a month with a custom domain`;

const RDYRCT_ROWS = {
  entry: `Hobby, ${PLAN_PRICES.hobby} a month`,
  links: `${formatNumber(PLAN_LIMITS.hobby.links)} links held at one time (delete one to free a slot)`,
  domains: `${PLAN_LIMITS.hobby.domains} custom domain`,
  history: `${PLAN_LIMITS.hobby.analyticsDays} days (${PLAN_LIMITS.pro.analyticsDays} on Pro, ${PLAN_PRICES.pro} a month)`,
  free: `${PLAN_LIMITS.free.links} links, ${PLAN_LIMITS.free.analyticsDays} days of analytics, ${formatNumber(PLAN_LIMITS.free.trackedClicks)} clicks counted a month, no custom domain`,
};

interface Alternative {
  name: string;
  path: string;
  /** Where the vendor's pricing page lives, for the footnote. */
  pricingUrl: string;
  /** What the tool is, in a line, and what it costs: the /compare card. */
  blurb: string;
  theirPrice: string;
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
    blurb: "The best-known shortener, with an Enterprise tier",
    theirPrice: "From $29 a month with a custom domain",
    title: "Bitly alternative: rdyrct vs Bitly",
    intro: "What each costs once you want links on your own domain, and who should stay put.",
    answer: `Bitly's first plan with a custom domain is Growth at $29 a month on annual billing. rdyrct includes one from ${PLAN_PRICES.hobby} a month. If you only need branded links, that is the difference. If you need an enterprise contract, Bitly is the safer pick.`,
    theirs: {
      entry: "Growth, $29 a month (billed annually)",
      links: "500 new links a month, renewing every month",
      domains: "1 custom domain",
      history: "4 months (1 year on Premium, $199 a month)",
      free: "5 links and 2 QR codes a month, shown with ads, no custom domain",
    },
    theyWin: [
      "An Enterprise tier with custom pricing and two years of click history, for a company that needs a vendor contract.",
      "Its link allowance renews every month. 500 new links a month adds up to more than a cap on links held at one time, which is what rdyrct has.",
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
    blurb: "Branded links and QR codes",
    theirPrice: "Free, or about $8 to $11 a month for more",
    title: "Rebrandly alternative: rdyrct vs Rebrandly",
    intro: "Where each is cheaper, and the one thing Rebrandly gives away that we do not.",
    answer: `Rebrandly's free plan includes a custom domain and ours does not. Past the free plans, rdyrct costs less: one custom domain from ${PLAN_PRICES.hobby} a month, where Rebrandly's Essentials starts at about $11. If you need a domain without paying, use Rebrandly.`,
    theirs: {
      entry: "Free, $0 (Essentials from about $8 to $11 a month)",
      links: "10 new links and 10 QR codes a month on Free, 250 on Essentials",
      domains: "1 custom domain on Free, 2 on Essentials",
      history: "Not stated (conversion data kept 6 months on Professional)",
      free: "10 links and 10 QR codes a month, 1 custom domain, watermarked QR codes",
    },
    theyWin: [
      "A custom domain on the free plan, plus a free rebrand.ly domain.",
      "Two custom domains on Essentials, against one on our Hobby.",
      "Its link allowance renews every month, where rdyrct caps the links you hold at one time.",
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
  dub: {
    name: "Dub",
    path: "/dub-alternative",
    pricingUrl: "dub.co/pricing",
    blurb: "Link management built for volume",
    theirPrice: "From $90 a month, no free plan listed",
    title: "Dub alternative: rdyrct vs Dub",
    intro: "Dub is built for volume. Here is what that costs, and when it is more than you need.",
    answer: `Dub's pricing page lists no free plan, and its plans start at $90 a month. rdyrct includes a custom domain from ${PLAN_PRICES.hobby} a month. If you create thousands of links a month, Dub is built for that and we are not. If you create a few hundred, you are paying for volume you will not use.`,
    theirs: {
      entry: "Business, $90 a month",
      links: "10,000 new links a month",
      domains: "100 custom domains",
      history: "3 years (5 years on Advanced, $300 a month)",
      free: "No free plan listed, a 14-day trial of Business and Advanced",
    },
    theyWin: [
      "10,000 new links and 250,000 tracked events a month on Business, and 50,000 links on Advanced.",
      "100 custom domains and 10 users on Business, 250 domains and 20 users on Advanced.",
      "Three to five years of analytics history, against 30 to 365 days on rdyrct.",
    ],
    weWin: [
      `A custom domain from ${PLAN_PRICES.hobby} a month, and ${PLAN_LIMITS.pro.domains} domains on Pro for ${PLAN_PRICES.pro}, where Dub starts at $90.`,
      `A free plan, with ${PLAN_LIMITS.free.links} links and a QR code generator. Dub lists none.`,
      "Click analytics that never store a visitor's IP address.",
      "Public code you can host yourself, and the API and MCP connector on every plan.",
    ],
    plans: [
      [
        "Business",
        "$90 a month",
        "10,000 new links and 250,000 events a month, 100 domains, 10 users",
      ],
      [
        "Advanced",
        "$300 a month",
        "50,000 new links and 1 million events a month, 250 domains, 20 users",
      ],
      ["Enterprise", "Custom, annual", "Unlimited links, events, domains and users"],
    ],
    planNote:
      "Dub's page shows a yearly toggle advertising a 10% discount, with no dollar amounts. Review sites disagree on whether a free tier still exists, so confirm on their page.",
    faq: [
      [
        "Does Dub have a free plan?",
        "Its pricing page lists a 14-day trial and no free plan. rdyrct's Free plan has no card and no trial clock, but no custom domain either.",
      ],
      [
        "When is Dub the better choice?",
        "When you create thousands of links a month, need a hundred domains, or want years of click history. rdyrct tops out at 3,000 links held at once on Pro.",
      ],
      [
        "Can I try rdyrct before moving?",
        "Yes. The Free plan needs no card, and the QR generator needs no account.",
      ],
    ],
  },
  shortio: {
    name: "Short.io",
    path: "/short-io-alternative",
    pricingUrl: "short.io/pricing",
    blurb: "Branded links with a large free plan",
    theirPrice: "Free, or $5 a month for more",
    title: "Short.io alternative: rdyrct vs Short.io",
    intro: "Short.io is cheaper on raw numbers. Here is when that stops mattering.",
    answer: `Short.io beats us on price and free-plan size: its free plan lists 5 custom domains, and ours lists none. We are the better pick when you care that click analytics never store a visitor's IP address, or want to host the code yourself. For a budget with no other needs, take Short.io.`,
    theirs: {
      entry: "Free, $0 (Hobby $5 a month)",
      links: "1,000 branded links on Free, issued once for the life of the account",
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
  tinyurl: {
    name: "TinyURL",
    path: "/tinyurl-alternative",
    pricingUrl: "tinyurl.com/app/pricing",
    blurb: "The oldest free shortener, with paid branded domains",
    theirPrice: "Free, or $9 a month with a branded domain",
    title: "TinyURL alternative: rdyrct vs TinyURL",
    intro:
      "TinyURL is free until you want your own domain or your numbers. Here is what each costs then.",
    answer: `TinyURL shortens a link for free, with no account. Its branded domains and analytics start on Pro at $9 a month, with 125 new links a month. rdyrct includes a custom domain and 30 days of click analytics from ${PLAN_PRICES.hobby} a month. If you only ever need a short link and nothing about who clicked it, TinyURL's free tool is enough.`,
    theirs: {
      entry: "Pro, $9 a month ($108 a year)",
      links: "125 new links a month on Pro, $1.50 for each 10 more",
      domains: "3 branded domains on Pro",
      history: "Not stated on the pricing page",
      free: "Short links with no account; branded domains and analytics need a paid plan",
    },
    theyWin: [
      "Shorten as many links as you like with no account at all. rdyrct's home page makes one link without an account, then asks you to sign up.",
      "3 branded domains on Pro at $9 a month, where our Hobby has 1 (Pro has 5, for the same $9).",
      "Unlimited tracked clicks on Pro, and Bulk 50K at $69 a month for 50,000 new links a month.",
      "Link expiry dates you can set, and an Enterprise plan with a 99.9% uptime guarantee.",
    ],
    weWin: [
      `A custom domain from ${PLAN_PRICES.hobby} a month instead of $9.`,
      `A cap on links you hold, not links you make: ${formatNumber(PLAN_LIMITS.hobby.links)} on Hobby, with no charge for each 10 more.`,
      `Teammates on every plan (${PLAN_LIMITS.free.members} on Free, ${PLAN_LIMITS.pro.members} on Pro).`,
      "Click analytics that never store a visitor's IP address, the API and MCP connector on every plan, and public code you can host yourself.",
    ],
    plans: [
      ["Free", "$0", "Short links with no account, no branded domain or analytics"],
      [
        "Pro",
        "$9 a month ($108 a year)",
        "125 links a month (+$1.50 per 10), unlimited tracked clicks, 3 branded domains",
      ],
      [
        "Bulk 50K",
        "$69 a month ($828 a year)",
        "50,000 links and 50,000 tracked clicks a month, 3 branded domains",
      ],
      ["Enterprise", "From $3,999 a year", "Custom limits, 99.9% uptime guarantee"],
    ],
    planNote:
      "TinyURL's page lists each paid plan with a monthly and a yearly figure, before tax. Its Free column shows its limits as icons rather than numbers, so check there for the detail.",
    faq: [
      [
        "Is TinyURL free?",
        "Making a short link is free, with no account. Branded domains, link analytics and editing come with its paid plans, from $9 a month.",
      ],
      [
        "Will my old TinyURL links keep working if I move?",
        "Links on tinyurl.com stay with TinyURL, so leave them where they are. Make new links on your own domain from now on, and those move with you.",
      ],
      [
        "Bitly or TinyURL?",
        `Bitly's first plan with a custom domain costs $29 a month, TinyURL's $9 and rdyrct's ${PLAN_PRICES.hobby}. Our Bitly page has the detail.`,
      ],
    ],
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

/** A vendor's plans: the first column bold, the price in tabular figures,
 *  what it includes muted, then the note on how the page read. */
function PlansSection({
  heading,
  headers,
  rows,
  note,
}: {
  heading: string;
  headers: string[];
  rows: string[][];
  note: string;
}) {
  return (
    <section className="flex flex-col gap-6 pb-12">
      <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{heading}</h2>
      <Table minWidth={headers.length > 3 ? "min-w-2xl" : "min-w-xl"} className={LIT_TABLE}>
        <thead>
          <tr>
            {headers.map((header) => (
              <Th key={header}>{header}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join(" ")}>
              {row.map((cell, i) => (
                <Td
                  key={headers[i]}
                  className={
                    i === 0
                      ? "font-bold"
                      : headers[i] === "Price"
                        ? "tnum whitespace-nowrap"
                        : i === row.length - 1
                          ? "text-muted"
                          : undefined
                  }
                >
                  {cell}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-muted">{note}</p>
    </section>
  );
}

function Questions({ faq, blog }: Pick<Alternative, "faq" | "blog">) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">Questions</h2>
      {faq.map(([question, answer]) => (
        <div key={question}>
          <h3 className="font-bold">{question}</h3>
          <p className="mt-1 text-muted">{answer}</p>
        </div>
      ))}
      {blog && (
        <p className="text-sm">
          <a href={blog.href} className="text-accent hover:underline">
            {blog.label}
          </a>
        </p>
      )}
    </section>
  );
}

function SignupBand({ children }: { children?: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-4 border-t border-border py-16">
      <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        Try it free. Move over when you are ready.
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to="/signup"
          onClick={() => trackCta("alternative_page_signup")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          Sign up free
        </Link>
        {children}
      </div>
      <p className="text-xs text-muted">
        No credit card. Every plan is on our{" "}
        <Link to="/pricing" className="text-accent hover:underline">
          pricing page
        </Link>
        .
      </p>
    </section>
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
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          The short answer
        </h2>
        <p className="text-muted">{data.answer}</p>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          rdyrct and {data.name}
        </h2>
        <Table minWidth="min-w-xl" className={LIT_TABLE}>
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

      <PlansSection
        heading={`${data.name} plans`}
        headers={["Plan", "Price", "What it includes"]}
        rows={data.plans}
        note={data.planNote}
      />

      <Questions faq={data.faq} blog={data.blog} />
      <SignupBand />
    </MarketingPage>
  );
}

/**
 * /qr-code-monkey-alternative: the QR generators, on one page.
 *
 * Nobody searches "qr.io alternative" or "qrcode monkey alternative" (ten a
 * month at most), but "qr code monkey" and "qrcode monkey" get about 72,000
 * US searches a month, "qr.io" about 7,000 and "qr code generator pro" 1,600.
 * One page named for the biggest, comparing all three, rather than three
 * thin ones. Figures from each vendor's own page on CHECKED.
 */
const QR_TOOLS = ["QR Code Monkey", "QR.io", "QR Code Generator Pro"] as const;

const QR_ROWS: [label: string, rdyrct: string, theirs: [string, string, string]][] = [
  [
    "Price",
    `Generator free; links you can track from free, logo codes from ${PLAN_PRICES.hobby} a month`,
    ["Free", "$39.99 a month, or $350 a year", "Not shown to our reader (prices load by region)"],
  ],
  [
    "Account to make a code",
    "None",
    ["None", "Yes, after a 7-day free trial", "Yes, after a 14-day free trial"],
  ],
  ["Logo and colours", "Free", ["Free, with gradients", "Yes", "Yes"]],
  ["Downloads", "PNG, SVG", ["PNG, SVG, PDF, EPS", "PNG, SVG", "Not stated on its pricing page"]],
  [
    "Codes you can edit and track",
    `A code for a short link: ${PLAN_LIMITS.free.links} on Free, ${formatNumber(PLAN_LIMITS.hobby.links)} on Hobby`,
    [
      "None: static codes only",
      "Unlimited codes and scans",
      "2 on Starter, 50 on Advanced, 250 on Professional",
    ],
  ],
  [
    "People on one account",
    `${PLAN_LIMITS.free.members} on Free, ${PLAN_LIMITS.pro.members} on Pro`,
    ["No accounts", "5", "1, 2 or 5"],
  ],
];

const QR_PLANS: [tool: string, plan: string, price: string, includes: string][] = [
  [
    "QR Code Monkey",
    "Free",
    "$0",
    "Static codes with logo, colours and gradients, ads on the page",
  ],
  [
    "QR.io",
    "Monthly",
    "$39.99 a month",
    "Unlimited dynamic and static codes and scans, landing pages, API, bulk, 5 team members",
  ],
  ["QR.io", "Yearly", "$350 a year", "The same"],
  ["QR Code Generator Pro", "Starter", "Not shown", "2 dynamic codes, 10,000 scans, 1 user"],
  [
    "QR Code Generator Pro",
    "Advanced",
    "Not shown, annual",
    "50 dynamic codes, unlimited scans, 100 at once from a CSV, 2 users",
  ],
  [
    "QR Code Generator Pro",
    "Professional",
    "Not shown, annual",
    "250 dynamic codes, unlimited scans, 500 at once from a CSV, 5 users",
  ],
  ["QR Code Generator Pro", "Enterprise", "Custom", "White labeling and more codes"],
];

const QR_FAQ: Alternative["faq"] = [
  [
    "Is QR Code Monkey free?",
    "Yes. It makes static codes with no account. Its page carries ads for QR Code Generator Pro, which is where it sells scan counts and codes you can edit.",
  ],
  [
    "What happens to a QR.io code after the trial?",
    "QR.io says static codes keep working after its 7-day trial. Everything else needs its one plan, at $39.99 a month or $350 a year.",
  ],
  [
    "Can I change where a printed code points?",
    "Only if the code holds a short link you control. In rdyrct, make the code for one of your links, then change the link's destination whenever you like. The printed code stays the same.",
  ],
  [
    "Does rdyrct put a watermark on QR codes?",
    "No, not in the free generator and not on any plan.",
  ],
];

function QrAlternativePage() {
  return (
    <MarketingPage
      path="/qr-code-monkey-alternative"
      title="QR Code Monkey alternative"
      intro="QR Code Monkey, QR.io and QR Code Generator Pro against rdyrct: what a code costs, what you can download, and what it takes to count scans."
    >
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          The short answer
        </h2>
        <p className="text-muted">
          For a static code with your logo, QR Code Monkey and our{" "}
          <MarketingLink to="/qr-code-generator" className="text-accent hover:underline">
            QR code generator
          </MarketingLink>{" "}
          are both free and need no account. Ours has no ads and sends nothing you type to a server.
          QR Code Monkey has more download formats. To count scans or change a code after printing,
          QR.io charges $39.99 a month for one plan. rdyrct does it with a short link, free for{" "}
          {PLAN_LIMITS.free.links} links, with logo codes from {PLAN_PRICES.hobby} a month.
        </p>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          rdyrct and three QR generators
        </h2>
        <Table minWidth="min-w-3xl" className={LIT_TABLE}>
          <thead>
            <tr>
              <Th></Th>
              <Th className="bg-accent/5">rdyrct</Th>
              {QR_TOOLS.map((tool) => (
                <Th key={tool}>{tool}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QR_ROWS.map(([label, ours, theirs]) => (
              <tr key={label}>
                <Td className="font-bold">{label}</Td>
                <Td className="bg-accent/5">{ours}</Td>
                {theirs.map((value, i) => (
                  <Td key={QR_TOOLS[i]} className="text-muted">
                    {value}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs text-muted">
          Figures from qrcode-monkey.com, qr.io/pricing and qr-code-generator.com/pricing, {CHECKED}
          . rdyrct figures from our pricing page.
        </p>
      </section>

      <section className="grid gap-10 pb-12 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">
            Where the others are the better choice
          </h2>
          <BulletList
            items={[
              "QR Code Monkey downloads PDF and EPS as well as PNG and SVG, and has colour gradients, templates and a logo gallery.",
              "QR.io has unlimited dynamic codes and scans on one plan, plus landing pages and bulk creation.",
              "QR Code Generator Pro has 22 types of QR code, landing pages, and bulk creation from a CSV file.",
            ]}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">Where rdyrct is the better choice</h2>
          <BulletList
            items={[
              "The free generator has no ads, no account and no watermark, and the code is made in your browser.",
              `Codes you can repoint and count from free, and logo codes for tracked links from ${PLAN_PRICES.hobby} a month, against $39.99 at QR.io.`,
              "Scans counted by country, device and time, never with an IP address.",
              "Short links, QR codes and your own domain in one account, with teammates on every plan.",
            ]}
          />
        </div>
      </section>

      <PlansSection
        heading="Their plans"
        headers={["Tool", "Plan", "Price", "What it includes"]}
        rows={QR_PLANS}
        note="QR Code Generator Pro's page loads its prices for your region in the browser and showed none to our reader, so check them there. It quotes them before VAT. QR.io offers a 7-day money-back guarantee."
      />

      <Questions faq={QR_FAQ} />
      <SignupBand>
        <MarketingLink
          to="/qr-code-generator"
          className={buttonClass({ variant: "outline", className: "h-11 px-6 text-base" })}
        >
          Make a QR code now
        </MarketingLink>
      </SignupBand>
    </MarketingPage>
  );
}

/** What /compare shows for each page. */
const COMPARE_CARDS = [
  ...Object.values(ALTERNATIVES).map(({ name, path, blurb, theirPrice }) => ({
    name,
    path,
    blurb,
    theirPrice,
    ourPrice: RDYRCT_PRICE_LINE,
  })),
  {
    name: "QR Code Monkey",
    path: "/qr-code-monkey-alternative",
    blurb: "Free QR generators, with QR.io and QR Code Generator Pro",
    theirPrice: "Free static codes; QR.io $39.99 a month",
    ourPrice: "Free generator, no account; tracked codes free",
  },
];

/** The index the footer's "All comparisons" link opens: one card per tool, so
 * somebody who does not know which tool they are leaving can see them all. */
function CompareIndex() {
  return (
    <MarketingPage
      path="/compare"
      title="Compare rdyrct with other link shorteners"
      intro="What each costs once you want links on your own domain, and when the other tool is the better pick."
    >
      <section className="grid gap-4 py-12 sm:grid-cols-2">
        {COMPARE_CARDS.map((tool) => (
          <Link
            key={tool.path}
            to={tool.path}
            className="lit group flex flex-col gap-5 rounded-3xl border border-border bg-surface p-6 transition-colors hover:border-accent/40"
          >
            <div>
              <h2 className="text-2xl font-bold tracking-tight">vs {tool.name}</h2>
              <p className="mt-1 text-muted">{tool.blurb}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-3">
                <dt className="text-sm text-muted">{tool.name}</dt>
                <dd className="font-medium text-balance">{tool.theirPrice}</dd>
              </div>
              <div className="flex flex-col gap-1 rounded-md border border-accent/30 bg-accent/5 p-3">
                <dt className="text-sm text-muted">rdyrct</dt>
                <dd className="font-medium text-balance">{tool.ourPrice}</dd>
              </div>
            </dl>
            <span className="mt-auto inline-flex items-center gap-1.5 font-medium text-accent">
              View comparison
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>
      <section className="flex flex-col items-start gap-3 border-t border-border py-12">
        <h2 className="text-xl font-bold tracking-tight">Not on the list?</h2>
        <p className="text-muted">
          Tell us which tool you are leaving and we will add it.{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">
            Write to support
          </a>
          .
        </p>
      </section>
    </MarketingPage>
  );
}
export function ComparePage() {
  return <CompareIndex />;
}
export function BitlyAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.bitly} />;
}
export function RebrandlyAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.rebrandly} />;
}
export function DubAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.dub} />;
}
export function ShortIoAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.shortio} />;
}
export function TinyUrlAlternativePage() {
  return <AlternativePage data={ALTERNATIVES.tinyurl} />;
}
export function QrCodeMonkeyAlternativePage() {
  return <QrAlternativePage />;
}
