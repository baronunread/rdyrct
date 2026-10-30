/**
 * /google-url-shortener: for people whose goo.gl links stopped working.
 *
 * "goo gl" gets about 450,000 US searches a month, most of them people
 * following a maps.app.goo.gl link, which is not ours to win. The part that
 * is: "google url shortener" (6,600), "goo gl link shortener" and "google
 * link shortener" (2,900 each). Those people want to know what happened and
 * where to go. Every date here is from Google's own posts, linked at the
 * foot of the page; recheck them before changing a word.
 */
import { Link } from "@tanstack/react-router";
import { MarketingPage } from "../components/marketing-page";
import { trackCta } from "../lib/track-cta";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { buttonClass } from "../ui/button-class";

const TIMELINE = [
  [
    "2018",
    "Google announces the end of its URL shortener and stops taking new links. Existing ones keep redirecting.",
  ],
  [
    "July 2024",
    "Google says every goo.gl link will stop working after August 25, 2025, and answer with a 404.",
  ],
  [
    "August 23, 2024",
    "A growing share of links start showing a notice before they redirect: “This link will no longer work in the near future.”",
  ],
  [
    "August 1, 2025",
    "Google changes the plan: only links with no activity in late 2024, the ones showing the notice, will stop. Links still in use keep working.",
  ],
  ["August 25, 2025", "The links that showed the notice stop working."],
] as const;

const MOVE_STEPS = [
  [
    "Find where each link went",
    "Open each goo.gl link you still have. If it redirects, note the destination. If it is dead, look for the address in the email, document or post where you first shared it.",
  ],
  [
    "Make a new short link",
    `Paste the destination into rdyrct. On the free plan the link gets a random slug on our domain. From ${PLAN_PRICES.hobby} a month it can sit on your own domain, with words you choose.`,
  ],
  [
    "Replace the old link where people find it",
    "Update your website, profiles, email signatures and documents. For anything printed, make a QR code for the new short link.",
  ],
  [
    "Watch the clicks",
    "Every link counts its clicks by country, referrer and device, so you can see which old places still send people.",
  ],
] as const;

const FAQ = [
  [
    "Do goo.gl links still work?",
    "Some do. Google kept the links that were still in use and turned off the ones that showed a deactivation notice in late 2024. To check one, open it: if it takes you straight to the page with no message, Google says it will keep working.",
  ],
  [
    "Are maps.app.goo.gl links affected?",
    "No. Google says goo.gl links its own apps make, such as the ones Google Maps shares, keep working.",
  ],
  [
    "Can I get my dead goo.gl link back?",
    "No. Google does not reactivate them or move them elsewhere. Make a new short link to the same destination and replace the old one wherever you can.",
  ],
  [
    "How do I stop this happening again?",
    "Put your short links on a domain you own. If a link service ever closes or changes its terms, you point the domain somewhere else and the links you printed keep their address.",
  ],
] as const;

const SOURCES = [
  [
    "https://blog.google/technology/developers/googl-link-shortening-update/",
    "Google, “We’re updating our plans for goo.gl links”, August 1, 2025",
  ],
  [
    "https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/",
    "Google for Developers, “Google URL Shortener links will no longer be available”, July 18, 2024",
  ],
] as const;

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function GoogleUrlShortenerPage() {
  return (
    <MarketingPage
      path="/google-url-shortener"
      title="Google URL shortener (goo.gl): what happened, and what to use now"
      intro="Google shut down its URL shortener and turned off goo.gl links nobody was using. Here is what still works, and how to move your links somewhere you control."
    >
      <section className="mx-auto flex max-w-3xl flex-col gap-4 py-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          The short answer
        </h2>
        <p className="text-muted">
          You cannot make goo.gl links any more, and you have not been able to since 2018. Links
          that were still getting clicks in late 2024 keep working. Links that were not stopped on
          August 25, 2025, and will not come back. If you need a link shortener now, make new links
          on a service you can leave, ideally on a domain you own.
        </p>
      </section>

      <section className="grid gap-10 pb-12 sm:grid-cols-[1fr_2fr]">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          What Google did, and when
        </h2>
        <ol className="flex flex-col gap-4 border-l border-border pl-6">
          {TIMELINE.map(([when, what]) => (
            <li key={when}>
              <p className="font-bold">{when}</p>
              <p className="mt-1 text-muted">{what}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pb-12">
        <h2 className="mb-6 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Move your goo.gl links to rdyrct <span className="text-muted">in four steps.</span>
        </h2>
        <ol className="grid gap-6 border-t border-border sm:grid-cols-2 lg:grid-cols-4">
          {MOVE_STEPS.map(([title, body], index) => (
            <li key={title} className="pt-5 pr-6">
              <span className="tnum text-sm font-bold text-accent">{index + 1}</span>
              <p className="mt-1 font-bold">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto flex max-w-3xl flex-col gap-4 pb-12">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Why your own domain matters
        </h2>
        <p className="text-muted">
          A goo.gl link belonged to Google, so when Google stopped, so did the link, on every flyer
          and in every old email. A link on a domain you own, such as go.yourcompany.com/menu, keeps
          its address whichever service sits behind it. rdyrct includes one custom domain on Hobby (
          {PLAN_PRICES.hobby} a month) and {PLAN_LIMITS.pro.domains} on Pro ({PLAN_PRICES.pro}), and
          it is open source, so you can run it yourself.
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
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>Sources:</p>
          <ul className="flex flex-col gap-1">
            {SOURCES.map(([href, label]) => (
              <li key={href}>
                <a href={href} rel="noreferrer" className="text-accent hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col items-start gap-4 border-t border-border py-16">
        <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Make the new links somewhere you can leave.
        </h2>
        <Link
          to="/signup"
          onClick={() => trackCta("googl_page_signup")}
          className={buttonClass({ variant: "primary", className: "h-11 px-6 text-base" })}
        >
          Sign up free
        </Link>
        <p className="text-xs text-muted">
          No credit card. {PLAN_LIMITS.free.links} links on the free plan.
        </p>
      </section>
    </MarketingPage>
  );
}
