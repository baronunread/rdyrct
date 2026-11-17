/** The URL is tagged with the code the Worker uses on redirect (src/shared/utm.ts), so the page shows exactly what a short link would send.
 * Nothing leaves the browser until Shorten is pressed. */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, Copy, Plus, X } from "@/app/ui/icons";
import { EMPTY_UTM, UTM_KEYS } from "@/shared/utm";
import type { UtmFields } from "@/shared/utm";
import { Button, IconButton } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { CopyButton } from "../ui/copy-button";
import { cn } from "../ui/cn";
import { useSlideTo } from "../ui/tab-underline";
import { Segmented } from "../ui/segmented";
import { OverflowTip } from "../ui/overflow-tip";
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
import { FrameRow, FrameSection, FramedSections, SplitHeading } from "../components/marketing-kit";
import { FaqList } from "../components/faq-list";
import { TaggedText } from "../components/utm-tagged-text";
import { BulkInputs, BulkOutput } from "../components/utm-bulk";
import { bulkNote, useBulkLinks } from "../lib/utm-bulk";
import { PRESETS, splitTagged, taggedUrl, tidy, webAddress } from "../lib/utm-tools";
import {
  removeTemplate,
  sameTags,
  saveTemplate,
  templateKey,
  templateName,
  trimTags,
  useUtmTemplates,
} from "../lib/utm-templates";

type UtmKey = keyof UtmFields;

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

const PARAMETERS = [
  ["utm_source", "Where the visitor came from: google, newsletter, linkedin.", "Session source"],
  ["utm_medium", "The kind of channel: email, social, cpc, banner, qr.", "Session medium"],
  [
    "utm_campaign",
    "The campaign, promotion or launch, so every link in it reports together.",
    "Session campaign",
  ],
  ["utm_term", "The paid keyword. Most links leave it out.", "Session manual term"],
  [
    "utm_content",
    "Tells apart links that point to the same page, such as two buttons in one email.",
    "Session manual ad content",
  ],
  [
    "utm_id",
    "A campaign ID, the same one you use when you upload campaign data to Google Analytics. This builder does not add it: put it in by hand if you need it.",
    "Session campaign ID",
  ],
] as const;

const NAMING = [
  "Use lowercase everywhere. Google Analytics treats Email and email as two values.",
  "Pick one separator, hyphen or underscore, and keep it. Avoid spaces: they turn into %20 or +.",
  "One source name per platform, such as linkedin and not LinkedIn, linked-in and lnkd.",
  "One medium name per channel. Reuse email, social and cpc so channels group together.",
  "Name a campaign once, in the same words your team uses: spring-sale-2026.",
  "Keep a shared sheet of the names in use, and check it before you invent a new one.",
] as const;

const MISTAKES = [
  [
    "Tagging links inside your own site",
    "Google Analytics 4 keeps a visit's first source for the session, but a tagged click inside your site can take the credit for what the visitor does next, such as a sign-up or a sale. Tag links that bring people to your site, never links between your own pages.",
  ],
  [
    "Mixing upper and lower case",
    "Newsletter and newsletter, or Spring-Sale and spring-sale, split one campaign into two rows. The builder warns you when a value has a capital or a space.",
  ],
  [
    "Leaving out source, medium or campaign",
    "Google says to always use all three. A missing one shows as (not set) in your reports.",
  ],
  [
    "Putting personal data in a tag",
    "A tag travels with the link into every tool on the other end. Keep email addresses and names out.",
  ],
  [
    "Tagging a link that is already tagged",
    "Paste it in and the builder reads its tags into the fields, so you edit them instead of adding a second set.",
  ],
] as const;

const FAQS = [
  {
    q: "What is a UTM builder?",
    a: "A UTM builder adds tracking parameters to a link. You give it a web address and a source, medium and campaign, and it returns the same address with utm_source, utm_medium and utm_campaign added. Analytics tools read those parameters to say which campaign sent each visitor.",
  },
  {
    q: "How do I build a UTM link for Google Analytics?",
    a: "Paste your page address above, fill in source, medium and campaign, and copy the link. Google Analytics 4 reads the three tags with no set-up on your side. Use the link where the visitor will click it: in an email, an ad or a post.",
  },
  {
    q: "Which UTM parameters should I use?",
    a: "Always use utm_source, utm_medium and utm_campaign, as Google advises. Add utm_content when one campaign has several links to tell apart. utm_term is for paid search keywords. utm_id is for matching a campaign to data you upload to Google Analytics.",
  },
  {
    q: "Are UTM parameters case sensitive?",
    a: "Yes. Google states that parameter values are case sensitive, so utm_source=Google and utm_source=google show as two sources. Use lowercase for every value.",
  },
  {
    q: "Where do I see UTM data in Google Analytics 4?",
    a: "In the Traffic acquisition report under Reports, then Acquisition. It lists session source, medium and campaign, which come from your utm_source, utm_medium and utm_campaign.",
  },
  {
    q: "Should I put UTM tags on links inside my own website?",
    a: "No. Google Analytics 4 keeps the visit's first source for the session, but the tagged click can give your own site the credit for what happens after it, such as a sale. Use UTM tags only on links that bring people to your site from somewhere else.",
  },
  {
    q: "Can I build UTM links in bulk?",
    a: "Yes. Choose Many links, paste one address per line and pick the channels. The builder makes one tagged link for each address and channel, up to 500 at once. Copy them all, or download a CSV with each tag in its own column.",
  },
  {
    q: "Is this the same as Google's Campaign URL Builder?",
    a: "It adds the same utm_source, utm_medium, utm_campaign, utm_term and utm_content tags, so Google Analytics reads the links the same way. It also builds many links at once, saves templates, warns about capitals and spaces, and can shorten the link. It leaves out utm_id, which you can add by hand.",
  },
  {
    q: "Does this UTM builder store my links?",
    a: "No. The link is built in your browser and nothing is sent unless you press Shorten it. Templates you save stay in this browser. A short link made here works for 24 hours, then someone else can get its address; sign up to keep it for good.",
  },
] as const;

const GUIDES = [
  ["/blog/build-utm-links", "How to build UTM links"],
  ["/blog/utm-case-sensitivity", "Why UTM values are case sensitive"],
  ["/blog/utm-for-social-media", "UTM tags for social media"],
  ["/blog/click-id-vs-utm", "Click IDs and UTM tags"],
] as const;

function shortenBlocker(authed: boolean, atCap: boolean): "authed" | "cap" | null {
  if (authed) return "authed";
  return atCap ? "cap" : null;
}

const ELSEWHERE = {
  authed: { href: "/links", label: "Shorten it in the app" },
  cap: { href: "/signup", label: "Sign up to shorten it" },
} as const;

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
  sourceError,
  sourceRef,
}: {
  fields: UtmFields;
  setField: (key: UtmKey, value: string) => void;
  sourceError?: string;
  sourceRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {FIELDS.map(({ key, param, label, placeholder, tip, ...rest }) => (
        <Field
          key={key}
          label={label}
          optional={"optional" in rest}
          tip={`${param}: ${tip}`}
          error={key === "utmSource" ? sourceError : undefined}
        >
          <Input
            ref={key === "utmSource" ? sourceRef : undefined}
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

function Templates({
  templates,
  fields,
  onApply,
  onSave,
}: {
  templates: readonly UtmFields[];
  fields: UtmFields;
  onApply: (template: UtmFields) => void;
  onSave: () => void;
}) {
  const current = trimTags(fields);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {templates.length > 0 && <span className="mr-1 text-xs text-muted">Your templates</span>}
      {templates.map((template) => {
        const name = templateName(template);
        const on = sameTags(template, current);
        return (
          <span
            key={templateKey(template)}
            className={cn(
              "inline-flex max-w-full items-center rounded-[9px] p-0.5 transition-colors duration-150",
              on ? "bg-surface-2 smooth-shadow-ring-xs" : "bg-bg",
            )}
          >
            <OverflowTip content={name}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onApply(template)}
                className={cn(
                  "h-[30px] max-w-64 cursor-pointer truncate rounded-[7px] pr-1 pl-2.5 text-sm max-sm:h-9",
                  on ? "text-text" : "text-muted [@media(hover:hover)]:hover:text-text",
                )}
              >
                {name}
              </button>
            </OverflowTip>
            <IconButton label={`Remove template ${name}`} onClick={() => removeTemplate(template)}>
              <X size={12} />
            </IconButton>
          </span>
        );
      })}
      <Button variant="ghost" size="sm" onClick={onSave}>
        <Plus size={13} /> Save as template
      </Button>
    </div>
  );
}

function CaseNote({ fields, onTidy }: { fields: UtmFields; onTidy: () => void }) {
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

function ShortLinkResult({ link }: { link: AnonLink }) {
  const toast = useToast();
  return (
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
        <span className="text-xs text-muted">
          Works for 24 hours, then someone else can get its address. Sign up to keep it for good.
        </span>
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
      disabled={button.disabled}
    >
      <BusyContent busy={button.spinning}>
        {button.waiting ? CHALLENGE_LABEL : "Shorten it"}
      </BusyContent>
    </Button>
  );
}

function TaggedOutput({
  tagged,
  onNothing,
  children,
}: {
  tagged: string | null;
  onNothing: () => void;
  children: ReactNode;
}) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-bg bg-[radial-gradient(100%_140%_at_0%_0%,color-mix(in_oklab,var(--accent)_8%,transparent),transparent_60%)] p-1.5 pl-4 sm:flex-row sm:items-center">
      <output
        aria-label="Tagged link"
        className="block min-h-10 min-w-0 flex-1 py-2 font-mono text-sm leading-relaxed break-all"
      >
        {tagged ? (
          <TaggedText tagged={tagged} />
        ) : (
          <span className="font-sans text-muted">Paste a link to start.</span>
        )}
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

function addressReason(address: string): string | null {
  if (!address.trim()) return "Paste a link first";
  return webAddress(address) ? null : "Not a web address";
}

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
    applyTemplate: setFields,
    tidyAll: () =>
      setFields((current) => {
        const next = { ...current };
        for (const { key } of FIELDS) next[key] = tidy(current[key]);
        return next;
      }),
  };
}

function useAddressRefusal(address: string) {
  const [reason, setReason] = useState<string | null>(null);
  const [shakes, setShakes] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // After the shake remounts the field, so focus lands in the new input.
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

const MODES = [
  { id: "one", label: "One link" },
  { id: "many", label: "Many links" },
] as const;

type Mode = (typeof MODES)[number]["id"];

function useTemplateSave(fields: UtmFields) {
  const toast = useToast();
  const [error, setError] = useState<string | undefined>();
  const source = useRef<HTMLInputElement>(null);
  return {
    error,
    source,
    clearing:
      <A extends unknown[]>(edit: (...args: A) => void) =>
      (...args: A) => {
        setError(undefined);
        edit(...args);
      },
    save: () => {
      if (!fields.utmSource.trim()) {
        setError("Needed for a template");
        source.current?.focus();
        return;
      }
      if (!saveTemplate(fields)) {
        toast("Could not save the template: this browser's storage is off or full", "error");
        return;
      }
      toast("Template saved");
      trackCta("utm_page_template");
    },
  };
}

function useOneLink(form: ReturnType<typeof useUtmForm>, active: boolean) {
  const refusal = useAddressRefusal(form.address);
  const [made, setMade] = useState<AnonLink | null>(null);
  const tagged = taggedUrl(form.address, form.fields);
  const shortener = useShortener(active ? tagged : null, setMade);
  return { refusal, made, tagged, shortener };
}

type OneLink = ReturnType<typeof useOneLink>;

function OneLinkOutput({ one }: { one: OneLink }) {
  const { refusal, made, tagged, shortener } = one;
  return (
    <>
      <div className="flex flex-col">
        <TurnstileSlot challenge={shortener.challenge} />
        <TaggedOutput tagged={tagged} onNothing={refusal.refuse}>
          {!made && (
            <ShortenAction tagged={tagged} shortener={shortener} onNothing={refusal.refuse} />
          )}
        </TaggedOutput>
      </div>
      {made && <ShortLinkResult link={made} />}
    </>
  );
}

function Builder() {
  const [mode, setMode] = useState<Mode>("one");
  const form = useUtmForm();
  const templates = useUtmTemplates();
  const save = useTemplateSave(form.fields);
  const bulk = useBulkLinks(form.fields, templates);
  const one = useOneLink(form, mode === "one");
  const many = mode === "many";
  const note = many ? bulkNote(bulk.result) : null;

  return (
    <div
      data-utm-builder
      className="flex w-full max-w-4xl flex-col gap-1.5 rounded-[20px] bg-surface p-1.5 text-left smooth-shadow-ring-lg max-sm:-mx-4 max-sm:w-[calc(100%+2rem)]"
    >
      <div className="flex flex-col gap-4 px-3 pt-3 pb-2 sm:px-3.5">
        <Segmented
          label="Build"
          items={MODES}
          value={mode}
          onChange={(next) => {
            bulk.clearRefusal();
            setMode(next);
          }}
        />
        {many ? (
          <BulkInputs bulk={bulk} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <AddressField
              value={form.address}
              onChange={form.changeAddress}
              refusal={one.refusal}
            />
            <Presets fields={form.fields} onPick={form.pickPreset} />
          </div>
        )}

        <UtmFieldsGrid
          fields={form.fields}
          setField={save.clearing(form.setField)}
          sourceError={save.error}
          sourceRef={save.source}
        />
        <Templates
          templates={templates}
          fields={form.fields}
          onApply={save.clearing(form.applyTemplate)}
          onSave={save.save}
        />
      </div>

      {many ? <BulkOutput bulk={bulk} /> : <OneLinkOutput one={one} />}

      {/* Spoken when it changes: a screen reader hears that lines were left out. */}
      <p role="status" className="px-3 text-xs text-butter empty:hidden sm:px-3.5">
        {note}
      </p>
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
      intro="A UTM builder and campaign URL builder for Google Analytics: tag one link, or many at once, to see which campaign sent each visitor. No account, and nothing leaves your browser until you shorten it."
      hero={<Builder />}
    >
      <FramedSections>
        <FrameSection title="What each UTM parameter is for">
          <dl className="grid max-w-5xl gap-x-10 gap-y-5 text-sm md:grid-cols-2">
            {PARAMETERS.map(([param, meaning, dimension]) => (
              <div key={param} className="flex flex-col gap-1">
                <dt className="font-mono font-bold">{param}</dt>
                <dd className="max-w-prose text-muted">{meaning}</dd>
                <dd className="text-muted">
                  Google Analytics 4 dimension: <span className="text-text">{dimension}</span>
                </dd>
              </div>
            ))}
          </dl>
        </FrameSection>

        <FrameSection title="How Google Analytics 4 reads your tags">
          <div className="flex max-w-3xl flex-col gap-4 text-sm text-muted">
            <p>
              When a visitor lands on a page whose address has UTM tags, Google Analytics 4 starts a
              session and fills its source, medium and campaign from them. Look in Reports, then
              Acquisition, then Traffic acquisition, and group by Session source / medium or Session
              campaign.
            </p>
            <p>
              A tag you leave out shows as (not set). The tags do not show in the page path
              dimensions: GA4 leaves them out of Page path + query string and keeps them in Page
              location.
            </p>
            <p>
              Most other analytics tools read the same tags, so a link tagged here is not tied to
              Google Analytics.
            </p>
          </div>
        </FrameSection>

        <FrameSection title="Keep one spelling per value">
          <div className="flex max-w-3xl flex-col gap-4 text-sm text-muted">
            <p>
              Reports group by the exact text of each value. These habits keep one campaign in one
              row.
            </p>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {NAMING.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </FrameSection>

        <FrameSection title="Common UTM mistakes">
          <dl className="grid max-w-5xl gap-x-10 gap-y-5 text-sm md:grid-cols-2">
            {MISTAKES.map(([name, why]) => (
              <div key={name} className="flex flex-col gap-1">
                <dt className="font-bold">{name}</dt>
                <dd className="max-w-prose text-muted">{why}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-col gap-2 pt-2 text-sm">
            {GUIDES.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-accent underline underline-offset-4">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </FrameSection>

        <FrameSection title="UTM builder questions">
          <FaqList faqs={FAQS} />
        </FrameSection>

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
      </FramedSections>
    </MarketingPage>
  );
}
