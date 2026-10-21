/**
 * The landing page below the hero: one opening line, then a section for each
 * thing you get (links, QR codes, analytics), the way the best product pages
 * in this category are built. Each section has a plain benefit heading, the
 * product shown large over a soft light, and three details; picking a detail
 * changes what the product shows.
 *
 * Benefits, not machinery: redirects, data centres and status codes live in
 * the docs and on the comparison pages. Competitors are not named here
 * either; that is what the comparison pages are for.
 *
 * Everything in the panels is the product's own UI over sample data, marked
 * as such, never a screenshot (rdyrct-design, "Anti-patterns").
 */
import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useInView } from "motion/react";
import { MarketingLink } from "./marketing-link";
import { FrameRow, SplitHeading } from "./marketing-kit";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";

// The charts bundle is the largest thing the homepage can fetch, so the
// analytics panel asks for it only once it scrolls near the screen.
const AnalyticsScreen = lazy(() =>
  import("./landing-analytics").then((m) => ({ default: m.LandingAnalyticsMock })),
);
// The QR library loads the same way. A failed load shows no code rather than
// reaching the error boundary.
type Qr = typeof import("./qr");
const QRPreview = lazy(
  async (): Promise<{ default: ComponentType<ComponentProps<Qr["QRPreview"]>> }> => ({
    default: (await import("./qr").catch(() => null))?.QRPreview ?? NoQr,
  }),
);
function NoQr() {
  return null;
}

export function Manifesto() {
  return (
    <FrameRow className="bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] px-6 py-16 sm:px-10 md:py-24">
      <p className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        A short link is a promise to whoever taps it.{" "}
        <span className="text-muted">
          It should look like you, go straight to your page, and still work the day you stop paying.
        </span>
      </p>
    </FrameRow>
  );
}

type Detail<K extends string> = { key: K; title: string; body: ReactNode };

/**
 * One section: heading and a way in, the product over a soft light, and the
 * details as tabs that change what the product shows. Tabs, not a carousel:
 * nothing moves until the visitor picks something.
 */
function Pillar<K extends string>({
  id,
  lead,
  rest,
  action,
  details,
  wide,
  children,
}: {
  id?: string;
  lead: string;
  rest: string;
  action: ReactNode;
  details: readonly [Detail<K>, ...Detail<K>[]];
  wide?: boolean;
  children: (active: K, near: boolean) => ReactNode;
}) {
  const base = useId();
  // Nothing picked yet means the first detail.
  const [picked, setActive] = useState<K | null>(null);
  const active = picked ?? details[0].key;
  const stage = useRef<HTMLDivElement>(null);
  // "Near" a little before it is on screen, so a lazy panel has arrived by
  // the time anybody looks at it.
  const near = useInView(stage, { once: true, margin: "200px 0px" });

  return (
    <section id={id} aria-labelledby={`${base}-h`} className="scroll-mt-24">
      <FrameRow className="px-6 py-12 sm:px-10 md:py-16">
        <SplitHeading id={`${base}-h`} lead={lead} rest={rest} />
        <div className="mt-6">{action}</div>
      </FrameRow>
      <div
        ref={stage}
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${active}`}
        className="relative h-80 overflow-hidden border-t border-border/70 bg-surface-2 px-4 pt-8 md:h-88"
      >
        <div
          aria-hidden="true"
          className="landing-mesh absolute top-6 left-1/2 h-72 w-120 max-w-full -translate-x-1/2"
        />
        <div
          className={cn(
            "lit relative mx-auto rounded-2xl border border-border/70 bg-surface text-sm mask-[linear-gradient(#000_72%,transparent)]",
            wide ? "max-w-2xl p-4" : "max-w-md",
          )}
        >
          {children(active, near)}
        </div>
      </div>
      <DetailTabs base={base} label={lead} details={details} active={active} onPick={setActive} />
    </section>
  );
}

function DetailTabs<K extends string>({
  base,
  label,
  details,
  active,
  onPick,
}: {
  base: string;
  label: string;
  details: readonly Detail<K>[];
  active: K;
  onPick: (key: K) => void;
}) {
  // Arrow keys move along the row, as tabs do.
  const step = (event: KeyboardEvent, index: number) => {
    const by = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!by) return;
    event.preventDefault();
    const next = details[(index + by + details.length) % details.length];
    onPick(next.key);
    document.getElementById(`${base}-tab-${next.key}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid border-t border-border/70 bg-surface-2 sm:grid-cols-3"
    >
      {details.map((detail, index) => (
        <button
          key={detail.key}
          type="button"
          role="tab"
          id={`${base}-tab-${detail.key}`}
          aria-selected={detail.key === active}
          aria-controls={`${base}-panel`}
          tabIndex={detail.key === active ? 0 : -1}
          onClick={() => onPick(detail.key)}
          onKeyDown={(event) => step(event, index)}
          className="cursor-pointer border-border/70 border-l-2 border-l-transparent px-5 py-5 text-left text-sm text-muted opacity-60 transition-opacity not-first:border-t hover:opacity-100 aria-selected:border-l-accent aria-selected:opacity-100 sm:not-first:border-t-0 sm:not-first:border-l sm:not-first:aria-selected:border-l-2"
        >
          <span className="block font-bold text-text">{detail.title}</span>
          <span className="mt-1 block">{detail.body}</span>
        </button>
      ))}
    </div>
  );
}

function PillarLink({
  to,
  children,
}: {
  to: "/pricing" | "/qr-code-generator" | "/signup";
  children: ReactNode;
}) {
  return (
    <MarketingLink
      to={to}
      className={buttonClass({ variant: "outline", className: "rounded-full px-4" })}
    >
      {children}
    </MarketingLink>
  );
}

/* ---- Links ---------------------------------------------------------- */

const SAMPLE_LINKS = [
  { slug: "spring", to: "acme.com/collections/spring", clicks: "1,284" },
  { slug: "podcast", to: "acme.com/episodes/42", clicks: "692" },
  { slug: "menu", to: "acme.com/menu.pdf", clicks: "411" },
];

export function LinksPillar() {
  return (
    <Pillar
      lead="Links that look like you."
      rest="Put your own domain in front and pick words people remember."
      action={<PillarLink to="/pricing">See plans with a domain</PillarLink>}
      details={[
        {
          key: "domain",
          title: "Your own domain",
          body: "From $4 a month, with TLS set up for you.",
        },
        {
          key: "words",
          title: "Words you choose",
          body: "go.acme.com/spring, not a string nobody trusts.",
        },
        {
          key: "tags",
          title: "Campaign tags",
          body: "Source and campaign on every link, no UTM codes by hand.",
        },
      ]}
    >
      {(active) => <LinksPanel active={active} />}
    </Pillar>
  );
}

function LinksPanel({ active }: { active: "domain" | "words" | "tags" }) {
  if (active === "words") return <SlugPanel />;
  if (active === "tags") return <TagsPanel />;
  return (
    <ul>
      {SAMPLE_LINKS.map((link) => (
        <li
          key={link.slug}
          className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono">go.acme.com/{link.slug}</span>
            <span className="block truncate text-xs text-muted">↳ {link.to}</span>
          </span>
          <span className="tnum hidden text-xs text-muted sm:inline">{link.clicks} clicks</span>
          <span className="rounded-full border border-accent-2/40 px-2 text-xs text-accent-2">
            Active
          </span>
        </li>
      ))}
    </ul>
  );
}

function SlugPanel() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted">Short link</p>
      <p className="flex items-center rounded-lg border border-accent px-3 py-2 font-mono">
        <span className="text-muted">go.acme.com/</span>
        <span className="text-accent">spring</span>
      </p>
      <p className="text-xs text-accent-2">Available on go.acme.com</p>
      <p className="text-xs text-muted">↳ acme.com/collections/spring</p>
    </div>
  );
}

function TagsPanel() {
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 p-4">
      {[
        ["Source", "newsletter"],
        ["Medium", "email"],
        ["Campaign", "spring-sale"],
      ].map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="rounded-md border border-border/70 px-2 py-1 font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- QR codes ------------------------------------------------------- */

export function QrPillar() {
  return (
    <Pillar
      lead="Print once. Change it later."
      rest="QR codes with your logo, pointing wherever you need this week."
      action={<PillarLink to="/qr-code-generator">Make a QR code</PillarLink>}
      details={[
        {
          key: "edit",
          title: "Edit after printing",
          body: "Change where a code points. The poster on the wall keeps working.",
        },
        { key: "logo", title: "Your logo and colours", body: "On every code, as PNG or SVG." },
        { key: "free", title: "A free generator", body: "Make one without an account." },
      ]}
    >
      {(active, near) => <QrPanel active={active} near={near} />}
    </Pillar>
  );
}

function QrPanel({ active, near }: { active: "edit" | "logo" | "free"; near: boolean }) {
  return (
    <div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
      <div className="size-28 shrink-0 sm:size-32 overflow-hidden rounded-xl border border-border/70 bg-white">
        {near && (
          <Suspense>
            <QRPreview
              url="https://go.acme.com/spring"
              size={128}
              sizeClass="size-28 sm:size-32"
              logo={active === "free" ? undefined : "/favicon.svg"}
            />
          </Suspense>
        )}
      </div>
      <QrCaption active={active} />
    </div>
  );
}

function QrCaption({ active }: { active: "edit" | "logo" | "free" }) {
  if (active === "free")
    return (
      <p className="text-muted">
        No account, no watermark.{" "}
        <MarketingLink to="/qr-code-generator" className="text-accent hover:underline">
          Open the generator
        </MarketingLink>
      </p>
    );
  if (active === "logo")
    return (
      <div className="flex flex-col gap-2 text-xs">
        <span className="rounded-md border border-border/70 px-2.5 py-1.5">Download SVG</span>
        <span className="rounded-md border border-border/70 px-2.5 py-1.5">Download PNG</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <p className="font-bold">Spring poster</p>
      <p className="font-mono text-xs text-muted">go.acme.com/spring</p>
      <p className="mt-2 text-xs text-muted">
        Now points to <span className="font-mono text-text">acme.com/sale</span>
      </p>
      <p className="mt-2 rounded-lg bg-text px-2.5 py-1.5 text-xs text-bg">
        Destination changed. The poster still works.
      </p>
    </div>
  );
}

/* ---- Analytics ------------------------------------------------------ */

export function AnalyticsPillar({ ask }: { ask: ReactNode }) {
  return (
    <Pillar
      id="analytics"
      lead="See which post paid off."
      rest="Every click's country, source and device, against the week before."
      action={ask}
      wide
      details={[
        {
          key: "trend",
          title: "Clicks over time",
          body: "From the last 24 hours to the last year.",
        },
        {
          key: "sources",
          title: "Top sources",
          body: "Which post, email or poster brought people in.",
        },
        {
          key: "personal",
          title: "Nothing personal",
          body: "No IP address kept. Country, source and device, and that is all.",
        },
      ]}
    >
      {(active, near) => <AnalyticsPanel active={active} near={near} />}
    </Pillar>
  );
}

const SOURCES = [
  { name: "newsletter", clicks: 1612 },
  { name: "instagram", clicks: 1408 },
  { name: "poster (QR)", clicks: 1103 },
  { name: "podcast", clicks: 783 },
];

function AnalyticsPanel({
  active,
  near,
}: {
  active: "trend" | "sources" | "personal";
  near: boolean;
}) {
  if (active === "sources") return <SourcesPanel />;
  if (active === "personal") return <ClickRecord />;
  return near ? (
    <Suspense>
      <AnalyticsScreen />
    </Suspense>
  ) : null;
}

/** One scale for every bar: the top source is the full width. */
function SourcesPanel() {
  const top = SOURCES[0].clicks;
  return (
    <div className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-x-3 gap-y-3 p-2">
      {SOURCES.map((source) => (
        <div key={source.name} className="contents">
          <span>{source.name}</span>
          <span
            className="h-2 rounded-full bg-accent"
            style={{ width: `${(source.clicks / top) * 100}%` }}
          />
          <span className="tnum text-right">{source.clicks.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  );
}

function ClickRecord() {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-y-3 p-2">
      <dt className="text-muted">Country</dt>
      <dd>Italy</dd>
      <dt className="text-muted">Referrer</dt>
      <dd className="font-mono">instagram.com</dd>
      <dt className="text-muted">Device</dt>
      <dd>Mobile</dd>
      <dt className="text-muted">IP address</dt>
      <dd className="text-muted line-through">never stored</dd>
    </dl>
  );
}

/* ---- Teams and code ------------------------------------------------- */

export function TeamsAndCode() {
  return (
    <FrameRow className="grid md:grid-cols-2">
      <div className="px-6 py-12 sm:px-10">
        <SplitHeading
          className="text-2xl sm:text-3xl"
          lead="Work as a team."
          rest="Owners, admins, members and viewers, and a record of who made which link."
        />
      </div>
      <div className="border-t border-border/70 px-6 py-12 sm:px-10 md:border-t-0 md:border-l">
        <SplitHeading
          className="text-2xl sm:text-3xl"
          lead="Or let your code do it."
          rest="A REST API and an MCP server on every plan, free included."
        />
        <MarketingLink
          to="/docs"
          className={buttonClass({ variant: "outline", className: "mt-6 rounded-full px-4" })}
        >
          API and MCP docs
        </MarketingLink>
      </div>
    </FrameRow>
  );
}
