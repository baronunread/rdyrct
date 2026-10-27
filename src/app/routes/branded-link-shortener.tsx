/**
 * /branded-link-shortener: the page for "branded link shortener", "branded
 * url shortener" and "branded short links". Search Console showed about 120
 * impressions a month for those words with nothing of ours above position 70,
 * because no page was about them: the blog post is an article, and the search
 * wants a product.
 *
 * So the page answers what someone choosing one needs: what it takes to put
 * links on their own domain, what it costs, and what changes for the people
 * who click. Figures come from PLAN_LIMITS and PLAN_PRICES so they cannot
 * drift from the plans.
 */
import { Link } from "@tanstack/react-router";
import { MarketingPage } from "../components/marketing-page";
import { trackCta } from "../lib/track-cta";
import { formatNumber } from "../lib/numbers";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { Table, Th, Td } from "../ui/misc";

const PATH = "/branded-link-shortener";

const STEPS = [
  {
    title: "Point a hostname at rdyrct",
    body: "At your DNS provider, add a CNAME record for a hostname you own, such as go.yourcompany.com.",
  },
  {
    title: "Add it in rdyrct",
    body: "We see the record and issue a TLS certificate for it. Nothing to renew, ever.",
  },
  {
    title: "Make links with words you choose",
    body: "go.yourcompany.com/spring instead of a string of random letters. Each link gets a QR code, and clicks show up by country, referrer and device.",
  },
] as const;

const PLANS = [
  [
    "Free",
    "$0",
    `rdyrct's shared domain with random slugs, ${PLAN_LIMITS.free.links} links. No custom domain.`,
  ],
  [
    "Hobby",
    `${PLAN_PRICES.hobby} a month`,
    `${PLAN_LIMITS.hobby.domains} custom domain, slugs you choose, ${formatNumber(PLAN_LIMITS.hobby.links)} links, QR codes in your colours and logo.`,
  ],
  [
    "Pro",
    `${PLAN_PRICES.pro} a month`,
    `${PLAN_LIMITS.pro.domains} custom domains, ${formatNumber(PLAN_LIMITS.pro.links)} links, ${PLAN_LIMITS.pro.members} members, a year of analytics.`,
  ],
] as const;

const FAQ = [
  [
    "Why can't I choose slugs on the shared domain?",
    "The shared domain is used by every account, so chosen words there would go to whoever claimed them first. On your own domain every slug is yours.",
  ],
  [
    "Can I keep the short links I already printed?",
    "Yes, if they are on a domain you own. Import from Bitly, Rebrandly, Short.io or Dub and the same short URLs keep working on that domain, checked through a TXT record so it works before you move its CNAME. A link printed on the shortener's own domain, like bit.ly, stays with that service.",
  ],
  [
    "What happens on the domain's homepage?",
    "You choose where go.yourcompany.com on its own sends people, usually your main site.",
  ],
  [
    "Do you store visitors' IP addresses?",
    "No. A click records country, referrer, device and time, and nothing that identifies the person.",
  ],
] as const;

export function BrandedLinkShortenerPage() {
  return (
    <MarketingPage
      path={PATH}
      title="Branded link shortener"
      intro="Short links on your own domain, with words you choose. People can see who sent a link before they tap it."
    >
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Why brand a short link
        </h2>
        <p className="text-muted">
          A link on a generic shortener could lead anywhere, so people hesitate before they tap it,
          and spam filters treat it the same way. A link on your own domain says who sent it, and
          the words after the slash say what is behind it. With rdyrct that costs{" "}
          {PLAN_PRICES.hobby} a month, certificate included.
        </p>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Set up in three steps
        </h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span className="tnum text-sm text-muted">{index + 1}</span>
              <h3 className="font-bold">{step.title}</h3>
              <p className="text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          What it costs
        </h2>
        <Table minWidth="min-w-xl" className="lit rounded-3xl border border-border">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Price</Th>
              <Th>Branded links</Th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map(([plan, price, includes]) => (
              <tr key={plan}>
                <Td className="font-bold">{plan}</Td>
                <Td className="tnum whitespace-nowrap">{price}</Td>
                <Td className="text-muted">{includes}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-sm text-muted">
          Coming from another tool? See{" "}
          <Link to="/rebrandly-alternative" className="text-accent hover:underline">
            rdyrct and Rebrandly
          </Link>{" "}
          or{" "}
          <Link to="/compare" className="text-accent hover:underline">
            every comparison
          </Link>
          .
        </p>
      </section>

      <section className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">Questions</h2>
        {FAQ.map(([question, answer]) => (
          <div key={question}>
            <h3 className="font-bold">{question}</h3>
            <p className="mt-1 text-muted">{answer}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col items-start gap-4 border-t border-border py-16">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Put your first link on your own domain.
        </h2>
        <Link
          to="/signup"
          onClick={() => trackCta("branded_page_signup")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          Sign up free
        </Link>
        <p className="text-xs text-muted">
          Start free, add a domain when you need one. Every plan is on our{" "}
          <Link to="/pricing" className="text-accent hover:underline">
            pricing page
          </Link>
          .
        </p>
      </section>
    </MarketingPage>
  );
}
