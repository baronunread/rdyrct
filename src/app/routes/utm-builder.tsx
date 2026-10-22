/**
 * A free UTM builder (#281, #326).
 *
 * Its own page for the same reason as /qr-code-generator: "utm builder" is a
 * search, and a tool that answers it is a better introduction than a post
 * about it. It needs no account.
 *
 * The URL is tagged with the same code the Worker uses when it applies a
 * link's UTM columns on redirect (src/shared/utm.ts), so what the page shows
 * is exactly what a short link made from it would send.
 *
 * What the many other builders lack, and #326 asked for: a check that the
 * values are lowercase, because analytics tools count "Email" and "email" as
 * two mediums; and "Shorten it", which hands the tagged URL to the same
 * anonymous shortener the landing page uses. Nothing leaves the browser
 * until that button is pressed.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ShieldCheck } from "@/app/ui/icons";
import { EMPTY_UTM, UTM_KEYS, buildDestination, resolveUtm, stripUtmParams } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { CopyButton } from "../ui/copy-button";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { useCap } from "../lib/cap";
import { MAX_ANON_LINKS, rememberAnonLink, storedAnonLinks } from "../lib/anon-links";
import { shortenAnonymously, type AnonLink } from "../lib/shorten-anon";
import { errorMessage } from "../lib/error-message";
import { trackCta } from "../lib/track-cta";
import { useAudience } from "../lib/audience";
import { HrefLink } from "../lib/router-search";
import { MarketingPage } from "../components/marketing-page";
import { FrameRow, SplitHeading } from "../components/marketing-kit";

type UtmKey = keyof UtmFields;

/** What each field asks for, in the order the parameters are usually read. */
const FIELD_COPY = {
  utmSource: {
    label: "Source",
    placeholder: "newsletter",
    tip: "Where the visitor came from: a newsletter, a site, a social network.",
  },
  utmMedium: {
    label: "Medium",
    placeholder: "email",
    tip: "The kind of traffic: email, social, cpc, banner.",
  },
  utmCampaign: {
    label: "Campaign",
    placeholder: "spring-sale",
    tip: "The campaign, launch or promotion the link belongs to.",
  },
  utmTerm: {
    label: "Term (optional)",
    placeholder: "running-shoes",
    tip: "The keyword a paid search ad was bought for.",
  },
  utmContent: {
    label: "Content (optional)",
    placeholder: "header-button",
    tip: "Tells apart two links in the same campaign, such as two ads or two buttons.",
  },
} satisfies Record<UtmKey, { label: string; placeholder: string; tip: string }>;

const FIELDS = UTM_KEYS.map(([param, key]) => ({ param, key, ...FIELD_COPY[key] }));

/** What each parameter is for, for the reference under the builder. */
const PARAMETERS = [
  [
    "utm_source",
    "The site, newsletter or app that sent the visitor. Required by Google Analytics.",
  ],
  ["utm_medium", "The channel: email, social, cpc, banner, qr. Required by Google Analytics."],
  ["utm_campaign", "The campaign name, so every link in one campaign reports together."],
  ["utm_term", "The paid keyword. Most links leave it out."],
  ["utm_content", "Which link of several in one place was clicked. Use it for A/B tests."],
] as const;

const GUIDES = [
  ["/blog/build-utm-links", "How to build UTM links"],
  ["/blog/utm-case-sensitivity", "Why UTM values are case sensitive"],
  ["/blog/utm-for-social-media", "UTM tags for social media"],
  ["/blog/click-id-vs-utm", "Click IDs and UTM tags"],
] as const;

/** A web address as typed, with https:// added when it has no scheme, or
 *  null when it is not one. Same rule the shortener applies. */
function webAddress(value: string): URL | null {
  try {
    const url = new URL(withScheme(value.trim()));
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

const withScheme = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

/** A pasted link that is already tagged: its address without the tags, and
 *  the fields filled from them (its own values win). Null when untagged. */
function splitTagged(value: string, fields: UtmFields) {
  const url = webAddress(value);
  if (!url || !UTM_KEYS.some(([param]) => url.searchParams.has(param))) return null;
  return { address: stripUtmParams(url.toString()), fields: resolveUtm(url.toString(), fields) };
}

/** The tagged address, or null until there is a web address to tag. */
function taggedUrl(value: string, fields: UtmFields): string | null {
  const url = webAddress(value);
  if (!url) return null;
  // resolveUtm with no address to read from just trims each field.
  return buildDestination(stripUtmParams(url.toString()), resolveUtm("", fields));
}

/** Lowercase, with hyphens for spaces: one spelling per value. */
const tidy = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");

/** Why the shortener cannot be offered here, or null when it can. */
function shortenBlocker(authed: boolean, atCap: boolean): "authed" | "cap" | null {
  if (authed) return "authed";
  return atCap ? "cap" : null;
}

const ELSEWHERE = {
  // Signed in, the app shortens with the same fields and keeps the link.
  authed: { href: "/links", label: "Shorten it in the app" },
  // Signed out with this browser's one free link spent, signing up is the
  // way to the next one.
  cap: { href: "/signup", label: "Sign up to shorten it" },
} as const;

function UtmFieldsGrid({
  fields,
  setField,
}: {
  fields: UtmFields;
  setField: (key: UtmKey, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FIELDS.map(({ key, param, label, placeholder, tip }) => (
        <Field key={key} label={label} tip={tip} hint={<span className="font-mono">{param}</span>}>
          <Input
            value={fields[key]}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      ))}
    </div>
  );
}

/** The case check: a quiet note with the fix, not an error. A value with a
 *  capital or a space still works, it just reports apart from its twin. */
function CaseNote({ fields, onTidy }: { fields: UtmFields; onTidy: () => void }) {
  const untidy = FIELDS.filter(({ key }) => fields[key] !== tidy(fields[key]));
  if (untidy.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted">
        Analytics tools count &ldquo;Email&rdquo; and &ldquo;email&rdquo; as two values. Check{" "}
        {untidy.map(({ param }, i) => (
          <span key={param}>
            {i > 0 && ", "}
            <span className="font-mono text-text">{param}</span>
          </span>
        ))}
        .
      </p>
      <Button variant="outline" size="sm" onClick={onTidy} className="shrink-0">
        Use lowercase and hyphens
      </Button>
    </div>
  );
}

/** The short link the anonymous shortener made from the tagged URL, and the
 *  one ask that follows it. */
function ShortLinkResult({ link }: { link: AnonLink }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3 border-t border-dashed border-border pt-4">
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Your short link"
          className="min-w-0 flex-1 truncate font-mono text-sm hover:text-accent"
        >
          {link.url.replace(/^https?:\/\//, "")}
        </a>
        <CopyButton
          text={link.url}
          label={`Copy ${link.url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-52 flex-1 text-sm text-muted">
          This link works for 24 hours. Sign up to keep it and see which campaign each click came
          from.
        </p>
        <HrefLink
          href="/signup"
          onClick={() => trackCta("utm_page_signup")}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          Keep this link <ArrowRight size={14} />
        </HrefLink>
      </div>
    </div>
  );
}

/** The anonymous shortener, as the landing's form uses it: the proof of
 *  work solved while the fields are filled in, the link stored for the claim
 *  at sign-up. */
function useShortener(tagged: string | null, onMade: (link: AnonLink) => void) {
  const toast = useToast();
  const { prime, guarded } = useCap("anon-link");
  const { authed } = useAudience();
  const [busy, setBusy] = useState(false);
  // Read after mount: storage is not there in the prerendered page.
  const [atCap, setAtCap] = useState(false);
  useEffect(() => setAtCap(storedAnonLinks().length >= MAX_ANON_LINKS), []);
  const blocker = shortenBlocker(authed, atCap);

  useEffect(() => {
    if (tagged && !blocker) prime();
  }, [tagged, blocker, prime]);

  const shorten = async (target: string) => {
    setBusy(true);
    try {
      const link = await shortenAnonymously(target, guarded);
      rememberAnonLink(link, target);
      setAtCap(true);
      onMade(link);
      trackCta("utm_page_shorten");
    } catch (error) {
      toast(errorMessage(error, "Could not shorten that link"), "error");
    } finally {
      setBusy(false);
    }
  };

  return { busy, blocker, shorten };
}

function ShortenAction({
  tagged,
  onMade,
}: {
  tagged: string | null;
  onMade: (link: AnonLink) => void;
}) {
  const { busy, blocker, shorten } = useShortener(tagged, onMade);
  if (blocker) {
    const { href, label } = ELSEWHERE[blocker];
    return (
      <HrefLink
        href={href}
        onClick={() => trackCta("utm_page_signup")}
        className={buttonClass({ variant: "outline" })}
      >
        {label}
      </HrefLink>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={() => tagged && void shorten(tagged)}
      disabled={!tagged || busy}
    >
      <BusyContent busy={busy}>Shorten it</BusyContent>
    </Button>
  );
}

/** The tagged link and its copy button, there before it has anything to
 *  show so the card does not grow on the first keystroke. */
function TaggedOutput({ tagged, children }: { tagged: string | null; children: ReactNode }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">Your tagged link</p>
      <output
        aria-label="Tagged link"
        className="block min-h-16 rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-sm break-all"
      >
        {tagged ?? <span className="font-sans text-muted">Enter a website URL to start.</span>}
      </output>
      <div className="flex flex-col gap-2 sm:flex-row">
        {tagged ? (
          <CopyButton
            text={tagged}
            label="Copy tagged link"
            display="button"
            onCopy={(text) => copyToClipboard(text, toast)}
          >
            Copy link
          </CopyButton>
        ) : (
          <Button variant="primary" disabled>
            Copy link
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}

function Builder() {
  const [address, setAddress] = useState("");
  const [fields, setFields] = useState<UtmFields>(EMPTY_UTM);
  const [made, setMade] = useState<AnonLink | null>(null);
  const tagged = taggedUrl(address, fields);

  // A pasted link that is already tagged fills the fields from its own
  // parameters, so editing a tagged link is the same as building one.
  const changeAddress = (value: string) => {
    const split = splitTagged(value, fields);
    setAddress(split?.address ?? value);
    if (split) setFields(split.fields);
  };
  const setField = (key: UtmKey, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const tidyAll = () =>
    setFields((current) => {
      const next = { ...current };
      for (const { key } of FIELDS) next[key] = tidy(current[key]);
      return next;
    });

  return (
    <div className="lit flex flex-col gap-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <Field label="Website URL">
        <Input
          type="text"
          inputMode="url"
          value={address}
          onChange={(e) => changeAddress(e.target.value)}
          placeholder="https://example.com/spring-sale"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <UtmFieldsGrid fields={fields} setField={setField} />

      <CaseNote fields={fields} onTidy={tidyAll} />

      <TaggedOutput tagged={tagged}>
        {/* Once made, the result below carries the next step. */}
        {!made && <ShortenAction tagged={tagged} onMade={setMade} />}
      </TaggedOutput>

      {made && <ShortLinkResult link={made} />}

      <p className="flex items-start gap-1.5 text-xs text-muted">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent-2" />
        The link is built in your browser. Nothing you type is sent anywhere unless you shorten it.
      </p>
    </div>
  );
}

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function UtmBuilderPage() {
  const { ctaTo, ctaLabel } = useAudience();
  return (
    <MarketingPage
      path="/utm-builder"
      title="UTM builder"
      intro="Add UTM parameters to a link so Google Analytics and other tools can tell which campaign sent each visitor. Fill in the fields, copy the link, or shorten it. No account."
    >
      {/* The hero closes its own frame; this one starts on the same line. */}
      <div className="-mt-px mb-16 border-x border-border/70">
        <FrameRow className="px-4 py-8 sm:px-10 sm:py-12">
          <div className="mx-auto max-w-4xl">
            <Builder />
          </div>
        </FrameRow>

        <FrameRow className="grid gap-10 px-6 py-12 sm:px-10 md:grid-cols-2 md:py-16">
          <section className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold tracking-tight text-balance">
              What each parameter does
            </h2>
            <dl className="flex flex-col gap-3 text-sm">
              {PARAMETERS.map(([param, meaning]) => (
                <div key={param}>
                  <dt className="font-mono font-bold">{param}</dt>
                  <dd className="text-muted">{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="flex flex-col gap-4 text-sm">
            <h2 className="text-2xl font-bold tracking-tight text-balance">
              Keep one spelling per value
            </h2>
            <p className="text-muted">
              UTM values are case sensitive. A campaign tagged &ldquo;Spring-Sale&rdquo; in one
              email and &ldquo;spring-sale&rdquo; in another shows up as two campaigns, and neither
              total is right. Pick lowercase with hyphens and use it everywhere. The builder warns
              you when a value strays from it.
            </p>
            <p className="text-muted">
              Leave out personal data. A UTM tag travels with the link and lands in every analytics
              tool on the other end, so an email address in one is shared with all of them.
            </p>
            <ul className="flex flex-col gap-2 pt-1">
              {GUIDES.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="text-accent underline underline-offset-4">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </FrameRow>

        <FrameRow className="flex flex-col gap-6 px-6 py-12 sm:px-10 md:flex-row md:items-end md:justify-between md:py-16">
          <SplitHeading
            className="text-2xl sm:text-3xl"
            lead="See which campaign each click came from."
            rest="Shorten the tagged link with rdyrct and every click is counted by campaign, country and device, with no IP address stored."
          />
          <HrefLink
            href={ctaTo}
            onClick={() => trackCta("utm_page_signup")}
            className={buttonClass({ variant: "primary", className: "shrink-0 rounded-full px-4" })}
          >
            {ctaLabel}
          </HrefLink>
        </FrameRow>
        <FrameRow />
      </div>
    </MarketingPage>
  );
}
