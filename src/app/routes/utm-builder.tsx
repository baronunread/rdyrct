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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Copy } from "@/app/ui/icons";
import { EMPTY_UTM, UTM_KEYS, buildDestination, resolveUtm, stripUtmParams } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { Button, IconButton } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { CopyButton } from "../ui/copy-button";
import { cn } from "../ui/cn";
import { useSlideTo } from "../ui/tab-underline";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { CHALLENGE_LABEL, guardedButton, useTurnstile } from "../lib/turnstile";
import { TurnstileSlot } from "../components/turnstile-slot";
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
    label: "Term",
    optional: true,
    placeholder: "running-shoes",
    tip: "The keyword a paid search ad was bought for.",
  },
  utmContent: {
    label: "Content",
    optional: true,
    placeholder: "header-button",
    tip: "Tells apart two links in the same campaign, such as two ads or two buttons.",
  },
} satisfies Record<UtmKey, { label: string; optional?: true; placeholder: string; tip: string }>;

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

/** Each parameter's colour, in the fields' order, shared by the tagged link
 *  so a value there reads as the field it came from. */
const PARAM_TONE = {
  utmSource: "text-mint",
  utmMedium: "text-sky",
  utmCampaign: "text-accent",
  utmTerm: "text-butter",
  utmContent: "text-pink",
} satisfies Record<UtmKey, string>;

/** Where links usually go, as the source and medium most teams use for
 *  each: one tap fills both. */
const PRESETS = [
  { label: "Newsletter", source: "newsletter", medium: "email" },
  { label: "Instagram", source: "instagram", medium: "social" },
  { label: "LinkedIn", source: "linkedin", medium: "social" },
  { label: "Google Ads", source: "google", medium: "cpc" },
  { label: "Print QR", source: "print", medium: "qr" },
] as const;

/**
 * The presets as a segmented control: one pill that slides to whichever
 * preset the fields match, and none when they match none. On a phone the
 * five wrap onto two lines, where a sliding pill cannot follow, so the
 * chosen one is shaded instead.
 */
function Presets({
  fields,
  onPick,
}: {
  fields: UtmFields;
  onPick: (preset: (typeof PRESETS)[number]) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useSlideTo<HTMLSpanElement>(track, '[aria-pressed="true"]');
  return (
    <div className="min-w-0">
      <span className="mb-1.5 flex min-h-4 items-center text-xs text-muted">Start from</span>
      {/* Radii nest: an 11px track, 2px of padding, 9px segments. */}
      <div
        ref={track}
        role="group"
        aria-label="Start from"
        className="relative flex gap-0.5 rounded-[11px] bg-bg p-0.5 max-sm:flex-wrap sm:w-fit"
      >
        <span
          ref={pill}
          aria-hidden
          data-still=""
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-[9px] bg-surface-2 smooth-shadow-ring-xs transition-[translate,width,opacity] duration-200 ease-out data-[still]:transition-none max-sm:hidden motion-reduce:transition-none"
        />
        {PRESETS.map((preset) => {
          const on = fields.utmSource === preset.source && fields.utmMedium === preset.medium;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(preset)}
              className={cn(
                // 34px inside the 2px track: as tall as the URL field beside it.
                "relative h-[34px] cursor-pointer rounded-[9px] px-3 text-sm whitespace-nowrap transition-[color,background-color] duration-150 ease-out max-sm:h-10",
                on
                  ? "text-text max-sm:bg-surface-2"
                  : "text-muted [@media(hover:hover)]:hover:text-text",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UtmFieldsGrid({
  fields,
  setField,
}: {
  fields: UtmFields;
  setField: (key: UtmKey, value: string) => void;
}) {
  return (
    // Five across only where a field has room for its name and its tip.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {FIELDS.map(({ key, param, label, placeholder, tip, ...rest }) => (
        // The parameter name sits in the tip rather than on the label line:
        // beside a name, a tip mark and "optional" it ran into the next field.
        <Field key={key} label={label} optional={"optional" in rest} tip={`${param}: ${tip}`}>
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

/** The tagged link, each value in its field's colour, or what to do first. */
function TaggedText({ tagged }: { tagged: string | null }) {
  if (!tagged) return <span className="font-sans text-muted">Paste a link to start.</span>;
  const { search, hash } = new URL(tagged);
  const tone = (param: string) => {
    const key = UTM_KEYS.find(([p]) => p === param)?.[1];
    return key ? PARAM_TONE[key] : "text-text";
  };
  // Split on the text itself rather than re-encoding the parameters, so
  // what shows is exactly `tagged`, character for character: the address,
  // the query (none for a link with no tags yet), then any #fragment, which
  // URLs put after the query.
  const base = tagged.slice(0, tagged.length - search.length - hash.length);
  const pairs = search ? search.slice(1).split("&") : [];
  return (
    <>
      <span className="text-muted">{base}</span>
      {pairs.map((pair, i) => (
        <QueryPair key={pair.split("=")[0]} pair={pair} lead={i === 0 ? "?" : "&"} tone={tone} />
      ))}
      {hash && <span className="text-muted">{hash}</span>}
    </>
  );
}

/** One `name=value` of the query: the name quiet, the value in its field's
 *  colour, keyed on the value so a changed one fades in. */
function QueryPair({
  pair,
  lead,
  tone,
}: {
  pair: string;
  lead: string;
  tone: (param: string) => string;
}) {
  // Split at the first "=" only: a value may hold another.
  const [name, value] = pair.split(/=(.*)/s);
  return (
    <span>
      <span className="text-placeholder">
        {lead}
        {name}
        {value === undefined ? "" : "="}
      </span>
      <span key={value} className={cn(tone(name), "motion-safe:animate-value-in")}>
        {value}
      </span>
    </span>
  );
}

/** The line under the link: the case check when a value strays from one
 *  spelling, otherwise what the page does with what you type. A value with
 *  a capital or a space still works, it just reports apart from its twin. */
function CaseNote({ fields, onTidy }: { fields: UtmFields; onTidy: () => void }) {
  // Edge spaces alone are no second spelling: the link leaves them out.
  const untidy = FIELDS.find(({ key }) => fields[key].trim() !== tidy(fields[key]));
  return (
    <div className="flex min-h-8 flex-col items-start justify-between gap-1 px-3 pb-1.5 text-xs sm:flex-row sm:items-center sm:gap-3 sm:px-3.5">
      {untidy ? (
        <>
          <p className="min-w-0 text-butter">
            &ldquo;{fields[untidy.key].trim()}&rdquo; and its lowercase twin report as two values.
          </p>
          <button
            type="button"
            onClick={onTidy}
            className="relative shrink-0 cursor-pointer font-semibold text-butter after:absolute after:-inset-2.5 [@media(hover:hover)]:hover:underline"
          >
            Use lowercase and hyphens
          </button>
        </>
      ) : (
        <p className="text-muted">
          Built in your browser. Nothing you type is sent anywhere unless you shorten it.
        </p>
      )}
    </div>
  );
}

/** The short link the anonymous shortener made from the tagged URL, and the
 *  one ask that follows it. */
function ShortLinkResult({ link }: { link: AnonLink }) {
  const toast = useToast();
  return (
    // Its own row under the tagged link, not in its place: change a tag
    // afterwards and the line above shows the new link while this one still
    // says what was shortened.
    <div className="flex flex-col gap-2 rounded-[14px] bg-bg p-1.5 pl-4 motion-safe:animate-value-in sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Your short link"
          className="truncate font-mono text-sm text-accent [@media(hover:hover)]:hover:underline"
        >
          {link.url.replace(/^https?:\/\//, "")}
        </a>
        <span className="text-xs text-muted">Works for 24 hours. Sign up to keep it.</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <CopyButton
          text={link.url}
          label={`Copy ${link.url}`}
          onCopy={(text) => copyToClipboard(text, toast)}
        />
        <HrefLink
          href="/signup"
          onClick={() => trackCta("utm_page_signup")}
          className={buttonClass({ variant: "primary", className: "max-sm:flex-1" })}
        >
          Keep this link <ArrowRight size={14} />
        </HrefLink>
      </div>
    </div>
  );
}

/** The anonymous shortener, as the landing's form uses it: the Turnstile
 *  challenge solved while the fields are filled in, the link stored for the
 *  claim at sign-up. */
function useShortener(tagged: string | null, onMade: (link: AnonLink) => void) {
  const toast = useToast();
  const { prime, guarded, challenge } = useTurnstile("anon-link");
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

  return { busy, blocker, shorten, challenge };
}

type Shortener = ReturnType<typeof useShortener>;

function ShortenAction({
  tagged,
  shortener,
  onNothing,
}: {
  tagged: string | null;
  shortener: Shortener;
  /** With no link to shorten it says why, on the field, like Copy. */
  onNothing: () => void;
}) {
  const { busy, blocker, shorten, challenge } = shortener;
  const button = guardedButton(busy, challenge);
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
      onClick={() => (tagged ? void shorten(tagged) : onNothing())}
      // Only while the request or the bot check is under way.
      disabled={button.disabled}
    >
      <BusyContent busy={button.spinning}>
        {button.waiting ? CHALLENGE_LABEL : "Shorten it"}
      </BusyContent>
    </Button>
  );
}

/** The tagged link on its panel, with Copy and Shorten beside it (under it
 *  on a phone, where beside it the link wrapped every twenty characters).
 *  There before it has anything to show, so the card does not grow on the
 *  first keystroke. */
function TaggedOutput({
  tagged,
  onNothing,
  children,
}: {
  tagged: string | null;
  /** Copy is never disabled: with no link to copy it says why, on the field. */
  onNothing: () => void;
  children: ReactNode;
}) {
  const toast = useToast();
  return (
    // 14px inside the sheet's 20px with its 6px of padding.
    <div className="flex flex-col gap-2 rounded-[14px] bg-bg bg-[radial-gradient(100%_140%_at_0%_0%,color-mix(in_oklab,var(--accent)_8%,transparent),transparent_60%)] p-1.5 pl-4 sm:flex-row sm:items-center">
      <output
        aria-label="Tagged link"
        className="block min-h-10 min-w-0 flex-1 py-2 font-mono text-sm leading-relaxed break-all"
      >
        <TaggedText tagged={tagged} />
      </output>
      <div className="flex shrink-0 items-center gap-1.5 max-sm:[&>a]:flex-1 max-sm:[&>button:last-child]:flex-1">
        {tagged ? (
          <CopyButton
            text={tagged}
            label="Copy link"
            onCopy={(text) => copyToClipboard(text, toast)}
          />
        ) : (
          <IconButton label="Copy link" onClick={onNothing}>
            <Copy size={12} />
          </IconButton>
        )}
        {children}
      </div>
    </div>
  );
}

/** Why the address field cannot be tagged, or null when it can. */
function addressReason(address: string): string | null {
  if (!address.trim()) return "Paste a link first";
  return webAddress(address) ? null : "Not a web address";
}

/** The address and the five tags, with the edits the builder offers: a
 *  pasted tagged link fills the fields from its own parameters (so editing
 *  a tagged link is the same as building one), a preset sets source and
 *  medium, and the case fix tidies every value at once. */
function useUtmForm() {
  const [address, setAddress] = useState("");
  const [fields, setFields] = useState<UtmFields>(EMPTY_UTM);
  return {
    address,
    fields,
    changeAddress: (value: string) => {
      const split = splitTagged(value, fields);
      setAddress(split?.address ?? value);
      if (split) setFields(split.fields);
    },
    setField: (key: UtmKey, value: string) =>
      setFields((current) => ({ ...current, [key]: value })),
    pickPreset: ({ source, medium }: (typeof PRESETS)[number]) =>
      setFields((current) => ({ ...current, utmSource: source, utmMedium: medium })),
    tidyAll: () =>
      setFields((current) => {
        const next = { ...current };
        for (const { key } of FIELDS) next[key] = tidy(current[key]);
        return next;
      }),
  };
}

/** Copy or Shorten with nothing to act on marks the address field, rather
 *  than being a greyed-out button that never says why: the reason in its
 *  label row, one shake, and focus. Any edit clears it. */
function useAddressRefusal(address: string) {
  const [reason, setReason] = useState<string | null>(null);
  const [shakes, setShakes] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // After the shake remounts the field, so focus lands in the new input,
  // not the one that just left the page.
  useEffect(() => {
    if (shakes) input.current?.focus();
  }, [shakes]);
  return {
    reason,
    shakes,
    input,
    clear: () => setReason(null),
    refuse: () => {
      setReason(addressReason(address));
      setShakes((n) => n + 1);
    },
  };
}

function AddressField({
  value,
  onChange,
  refusal,
}: {
  value: string;
  onChange: (value: string) => void;
  refusal: ReturnType<typeof useAddressRefusal>;
}) {
  return (
    <Field label="Website URL" error={refusal.reason ?? undefined}>
      <div key={refusal.shakes} className={cn(refusal.reason && "motion-safe:animate-shake")}>
        <Input
          ref={refusal.input}
          type="text"
          inputMode="url"
          value={value}
          onChange={(e) => {
            refusal.clear();
            onChange(e.target.value);
          }}
          placeholder="https://example.com/spring-sale"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </Field>
  );
}

function Builder() {
  const form = useUtmForm();
  const refusal = useAddressRefusal(form.address);
  const [made, setMade] = useState<AnonLink | null>(null);
  const tagged = taggedUrl(form.address, form.fields);
  const shortener = useShortener(tagged, setMade);

  return (
    // On a phone the sheet takes back most of the hero's gutter, as the QR
    // generator's does.
    <div
      data-utm-builder
      className="flex w-full max-w-4xl flex-col gap-1.5 rounded-[20px] bg-surface p-1.5 text-left smooth-shadow-ring-lg max-sm:-mx-4 max-sm:w-[calc(100%+2rem)]"
    >
      <div className="flex flex-col gap-4 px-3 pt-3 pb-2 sm:px-3.5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <AddressField value={form.address} onChange={form.changeAddress} refusal={refusal} />
          <Presets fields={form.fields} onPick={form.pickPreset} />
        </div>

        <UtmFieldsGrid fields={form.fields} setField={form.setField} />
      </div>

      {/* The Turnstile slot sits straight above the panel holding Shorten,
          in a column of its own so its empty box adds no gap. */}
      <div className="flex flex-col">
        <TurnstileSlot challenge={shortener.challenge} />
        <TaggedOutput tagged={tagged} onNothing={refusal.refuse}>
          {/* Once made, the row below carries the next step. */}
          {!made && (
            <ShortenAction tagged={tagged} shortener={shortener} onNothing={refusal.refuse} />
          )}
        </TaggedOutput>
      </div>

      {made && <ShortLinkResult link={made} />}

      <CaseNote fields={form.fields} onTidy={form.tidyAll} />
    </div>
  );
}

export function UtmBuilderPage() {
  const { ctaTo, ctaLabel } = useAudience();
  return (
    <MarketingPage
      path="/utm-builder"
      title="UTM builder"
      intro="Tag a link so Google Analytics and other tools can tell which campaign sent each visitor. No account, and nothing leaves your browser until you shorten it."
      hero={<Builder />}
    >
      {/* The hero closes its own frame; this one starts on the same line. */}
      <div className="-mt-px mb-16 border-x border-border/70">
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
