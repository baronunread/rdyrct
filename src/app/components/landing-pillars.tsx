/**
 * The landing page below the hero: one opening line, then a section for each
 * thing you get (links, QR codes, analytics). Each section has a plain
 * benefit heading and three details, each in a card of its own with a short
 * loop of the product doing that one thing.
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
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { useInView, useReducedMotion } from "motion/react";
import { MarketingLink } from "./marketing-link";
import { FrameRow, SplitHeading } from "./marketing-kit";
import { buttonClass } from "../ui/button-class";
import {
  ChartColumn,
  Check,
  Globe,
  ImagePlus,
  Link2,
  Pencil,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Target,
} from "../ui/icons";
import { cn } from "../ui/cn";

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
        A short link should show who sent it.{" "}
        <span className="text-muted">
          It should go straight to your page and keep working after you stop paying.
        </span>
      </p>
    </FrameRow>
  );
}

type Feature = {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: ReactNode;
  /** How many steps the loop has. The last one is the finished state: what
   *  the prerendered page, reduced motion and the first frame all show. */
  steps: number;
  scene: (step: number) => ReactNode;
};

/**
 * One section: heading and a way in, then each detail in a card of its own,
 * with a short loop of the product doing that one thing above what it is.
 */
function Pillar({
  id,
  lead,
  rest,
  action,
  features,
}: {
  id?: string;
  lead: string;
  rest: string;
  action: ReactNode;
  features: readonly Feature[];
}) {
  const base = useId();
  return (
    <section id={id} aria-labelledby={`${base}-h`} className="scroll-mt-24">
      <FrameRow className="px-6 py-12 sm:px-10 md:py-16">
        <SplitHeading id={`${base}-h`} lead={lead} rest={rest} />
        <div className="mt-6">{action}</div>
      </FrameRow>
      <FrameRow className="px-4 py-4 sm:px-6 sm:py-6">
        <ul className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </ul>
      </FrameRow>
    </section>
  );
}

/** Milliseconds a step of a card's loop lasts. */
const STEP_MS = 700;

/**
 * Which step of its loop a card is on. It starts finished, so the page reads
 * whole before any script runs, then plays from the top while the card is on
 * screen. Off screen it holds still; under reduced motion it never leaves the
 * finished state.
 */
function useLoop(card: RefObject<HTMLElement | null>, steps: number) {
  const inView = useInView(card, { amount: 0.5 });
  const reduced = useReducedMotion();
  const [step, setStep] = useState(steps - 1);
  useEffect(() => {
    if (!inView || reduced) return;
    const timer = setInterval(() => setStep((at) => (at + 1) % steps), STEP_MS);
    return () => clearInterval(timer);
  }, [inView, reduced, steps]);
  return reduced ? steps - 1 : step;
}

/**
 * A detail in a block of its own: the loop on a soft light, then the icon,
 * the title and one line. The loop is the product's own UI over sample data
 * and repeats what the words say, so it is hidden from assistive tech.
 */
function FeatureCard({ icon: Icon, title, body, steps, scene }: Feature) {
  const card = useRef<HTMLLIElement>(null);
  const step = useLoop(card, steps);
  return (
    <li
      ref={card}
      className="flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface-2"
    >
      <div
        aria-hidden="true"
        data-scene
        data-step={step}
        className="relative flex h-56 items-start justify-center overflow-hidden px-5 pt-10"
      >
        <div className="landing-mesh pointer-events-none absolute inset-x-0 top-0 h-48 opacity-70" />
        <div className="lit relative w-full max-w-sm rounded-xl border border-border/70 bg-surface text-sm">
          {scene(step)}
        </div>
      </div>
      <div className="flex flex-1 flex-col px-5 pt-2 pb-6 sm:px-6">
        <Icon size={18} className="text-accent" />
        <h3 className="mt-3 font-bold text-text">{title}</h3>
        <p className="mt-1 text-pretty text-muted">{body}</p>
      </div>
    </li>
  );
}

/** Shown from step `at` on: a fade and a few pixels of rise, reversible. */
function Reveal({
  at,
  step,
  className,
  children,
}: {
  at: number;
  step: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,translate,filter] duration-300 ease-out",
        step >= at ? "opacity-100" : "translate-y-1 opacity-0 blur-[2px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Two values in one place, the second taking over from step `at` with the
 *  crossfade an icon swap gets (scale, opacity and blur). */
function Swap({
  at,
  step,
  from,
  to,
}: {
  at: number;
  step: number;
  from: ReactNode;
  to: ReactNode;
}) {
  const after = step >= at;
  const layer = "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-300 ease-out";
  const out = "scale-95 opacity-0 blur-[3px]";
  return (
    <span className="inline-grid">
      <span className={cn(layer, after && out)}>{from}</span>
      <span className={cn(layer, !after && out)}>{to}</span>
    </span>
  );
}

function Available({ at, step, children }: { at: number; step: number; children: ReactNode }) {
  return (
    <Reveal at={at} step={step} className="flex items-center gap-1.5 text-xs text-accent-2">
      <Check size={14} />
      {children}
    </Reveal>
  );
}

/* ---- Links ---------------------------------------------------------- */

export function LinksPillar() {
  return (
    <Pillar
      lead="Branded short links."
      rest="Put your own domain in front and pick words people remember."
      action={<PillarLink to="/pricing">See plans with a domain</PillarLink>}
      features={[
        {
          icon: Globe,
          title: "Your own domain",
          body: "From $4 a month, with TLS set up for you.",
          steps: 6,
          scene: (step) => (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-xs text-muted">Short link</p>
              <p className="font-mono">
                <Swap at={2} step={step} from="rdyr.cc/k3Tq9" to="go.acme.com/spring" />
              </p>
              <Available at={3} step={step}>
                Certificate active on go.acme.com
              </Available>
            </div>
          ),
        },
        {
          icon: Pencil,
          title: "Words you choose",
          body: "go.acme.com/spring instead of random letters.",
          steps: 7,
          scene: (step) => (
            <div className="flex flex-col gap-2 p-4">
              <p className="text-xs text-muted">Short link</p>
              <p className="flex items-center rounded-lg border border-accent px-3 py-2 font-mono">
                <span className="text-muted">go.acme.com/</span>
                {step >= 1 && (
                  // Not on the last step: the card mounts there, off screen,
                  // and typing then would play where nobody sees it.
                  <span className={cn("text-accent", step < 6 && "motion-safe:animate-type-6")}>
                    spring
                  </span>
                )}
              </p>
              <Available at={3} step={step}>
                Available on go.acme.com
              </Available>
            </div>
          ),
        },
        {
          icon: Target,
          title: "Campaign tags",
          body: "Source and campaign on every link, no UTM codes by hand.",
          steps: 7,
          scene: (step) => (
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 p-4">
              {TAGS.map(([term, value], index) => (
                <Reveal
                  key={term}
                  at={index + 1}
                  step={step}
                  className="col-span-2 grid grid-cols-subgrid"
                >
                  <dt className="py-1 text-muted">{term}</dt>
                  <dd className="rounded-md border border-border/70 px-2 py-1 font-mono">
                    {value}
                  </dd>
                </Reveal>
              ))}
            </dl>
          ),
        },
      ]}
    />
  );
}

const TAGS = [
  ["Source", "newsletter"],
  ["Medium", "email"],
  ["Campaign", "spring-sale"],
] as const;

/* ---- QR codes ------------------------------------------------------- */

/** Where a QR card's code goes: white until the QR library loads, which it
 *  does only once the card is near the screen. The code draws its own frame,
 *  so this one has none: two frames the same size put it 2px past this box. */
function QrSlot({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const near = useInView(box, { once: true, margin: "200px 0px" });
  return (
    <div ref={box} className="relative grid size-24 shrink-0 rounded-lg bg-white">
      {near && <Suspense>{children}</Suspense>}
    </div>
  );
}

const SCENE_URL = "https://go.acme.com/spring";
// A light hairline, not the theme's border: on the dark theme that is a dark
// ring around a white code.
const SCENE_FRAME = "size-24 rounded-lg border-black/10";

/** The code a QR card shows. */
function SceneQr({ logo }: { logo?: boolean }) {
  return (
    <QrSlot>
      <QRPreview
        url={SCENE_URL}
        size={96}
        sizeClass={SCENE_FRAME}
        logo={logo ? "/favicon.svg" : undefined}
      />
    </QrSlot>
  );
}

/** Ink, then two brand colours a customer might pick. */
const QR_COLOURS = ["#17151f", "#6d4fc4", "#0f766e"];

/**
 * The colours card's code: a plain code, the logo landing in the middle, then
 * the ink turning one brand colour and then another.
 *
 * Every colour is its own code, drawn once and stacked, and the step only
 * changes which ones show. Redrawing one code with new options each step
 * blanked it for a frame every time (qr-code-styling empties its SVG before
 * it draws again) and cut between colours with no transition. All three are
 * drawn with room for a logo, so their modules line up, and the logo is
 * laid over them rather than drawn in, so it can scale in on its own.
 */
function BrandedQr({ step }: { step: number }) {
  // Ink for the first two steps, then one colour a step, holding the last.
  const colour = Math.min(Math.max(step - 1, 0), QR_COLOURS.length - 1);
  return (
    <QrSlot>
      {QR_COLOURS.map((ink, index) => (
        <div
          key={ink}
          // Each colour covers the ones before it, so a crossfade never shows
          // the white box through two half-faded codes.
          className={cn(
            "col-start-1 row-start-1 transition-opacity duration-300 ease-out",
            index > colour && "opacity-0",
          )}
        >
          <QRPreview url={SCENE_URL} size={96} sizeClass={SCENE_FRAME} color={ink} roomForLogo />
        </div>
      ))}
      <div className="absolute inset-0 grid place-items-center">
        <span
          className={cn(
            "rounded-[5px] bg-white p-0.5 transition-[opacity,scale,filter] duration-300 ease-out",
            step < 1 && "scale-50 opacity-0 blur-[2px]",
          )}
        >
          <img src="/favicon.svg" alt="" className="block size-[22px]" />
        </span>
      </div>
    </QrSlot>
  );
}

/** A download button in the colours card, pressed for the one step `at`. */
function SceneDownload({ at, step, children }: { at: number; step: number; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2.5 py-1.5 transition-[scale,border-color,color] duration-200 ease-out",
        step === at ? "scale-95 border-accent text-accent" : "border-border/70",
      )}
    >
      {children}
    </span>
  );
}

export function QrPillar() {
  return (
    <Pillar
      lead="Print once. Change it later."
      rest="QR codes with your logo, pointing wherever you need this week."
      action={<PillarLink to="/qr-code-generator">Make a QR code</PillarLink>}
      features={[
        {
          icon: RefreshCw,
          title: "Edit after printing",
          body: "Change where a code points. The poster on the wall keeps working.",
          steps: 7,
          scene: (step) => (
            <div className="flex items-center gap-4 p-4">
              <SceneQr logo />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-bold">Spring poster</p>
                <p className="text-xs text-muted">Points to</p>
                <p className="font-mono text-xs">
                  <Swap at={2} step={step} from="acme.com/winter" to="acme.com/sale" />
                </p>
                <Reveal at={3} step={step}>
                  <p className="mt-1 rounded-md bg-text px-2 py-1 text-xs text-bg">
                    Changed. The poster still works.
                  </p>
                </Reveal>
              </div>
            </div>
          ),
        },
        {
          icon: ImagePlus,
          title: "Your logo and colours",
          body: "On every code, as PNG or SVG.",
          // Plain, logo, two colours, then each download pressed in turn.
          steps: 7,
          scene: (step) => (
            <div className="flex items-center gap-4 p-4">
              <BrandedQr step={step} />
              <div className="flex flex-col gap-2 text-xs">
                <SceneDownload at={4} step={step}>
                  Download SVG
                </SceneDownload>
                <SceneDownload at={5} step={step}>
                  Download PNG
                </SceneDownload>
              </div>
            </div>
          ),
        },
        {
          icon: QrCode,
          title: "A free generator",
          body: "Make one without an account.",
          steps: 6,
          scene: (step) => (
            <div className="flex items-center gap-4 p-4">
              <Reveal at={3} step={step} className="shrink-0">
                <SceneQr />
              </Reveal>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="truncate rounded-md border border-border/70 px-2 py-1.5 font-mono text-xs">
                  {step >= 1 ? "acme.com/menu" : <span className="text-muted">Paste a link</span>}
                </p>
                <span
                  className={cn(
                    "rounded-md bg-accent px-2 py-1.5 text-center text-xs font-bold text-bg transition-[scale] duration-200 ease-out",
                    step === 2 && "scale-95",
                  )}
                >
                  Make QR code
                </span>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

/* ---- Analytics ------------------------------------------------------ */

/** Sample clicks a day for two weeks, for the trend card. */
const DAYS = [38, 44, 41, 52, 61, 47, 55, 63, 58, 72, 80, 69, 86, 94];
const SOURCES = [
  { name: "newsletter", clicks: 1612 },
  { name: "instagram", clicks: 1408 },
  { name: "poster (QR)", clicks: 1103 },
] as const;

export function AnalyticsPillar({ ask }: { ask: ReactNode }) {
  return (
    <Pillar
      id="analytics"
      lead="See which post paid off."
      rest="Every click's country, source and device, against the week before."
      action={ask}
      features={[
        {
          icon: ChartColumn,
          title: "Clicks over time",
          body: "From the last 24 hours to the last year.",
          steps: 6,
          scene: (step) => <TrendScene step={step} />,
        },
        {
          icon: Link2,
          title: "Top sources",
          body: "Which post, email or poster brought people in.",
          steps: 6,
          scene: (step) => <SourcesScene step={step} />,
        },
        {
          icon: ShieldCheck,
          title: "Nothing personal",
          body: "No IP address kept. Country, source and device, and that is all.",
          steps: 8,
          scene: (step) => <ClickRecord step={step} />,
        },
      ]}
    />
  );
}

/** Bars rise one after another, then the total and the change arrive. */
function TrendScene({ step }: { step: number }) {
  const top = Math.max(...DAYS);
  const total = DAYS.reduce((sum, day) => sum + day, 0);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Last 14 days</span>
        <Reveal at={2} step={step} className="tnum text-xs text-accent-2">
          +18% on the week before
        </Reveal>
      </div>
      <p className="tnum text-lg font-bold">{total.toLocaleString("en-US")} clicks</p>
      <div className="flex h-16 items-end gap-1">
        {DAYS.map((day, index) => (
          <span
            key={index}
            className="flex-1 origin-bottom rounded-sm bg-accent transition-[scale] duration-500 ease-out"
            style={{
              height: `${(day / top) * 100}%`,
              scale: step >= 1 ? "1 1" : "1 0",
              transitionDelay: step >= 1 ? `${index * 30}ms` : "0ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** One scale for every bar: the top source is the full width. */
function SourcesScene({ step }: { step: number }) {
  const top = SOURCES[0].clicks;
  return (
    <div className="grid grid-cols-[6rem_1fr_3rem] items-center gap-x-3 gap-y-3 p-4">
      {SOURCES.map((source, index) => (
        <div key={source.name} className="col-span-3 grid grid-cols-subgrid items-center">
          <span className="truncate">{source.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full origin-left rounded-full bg-accent transition-[scale] duration-500 ease-out"
              style={{
                width: `${(source.clicks / top) * 100}%`,
                scale: step >= 1 ? "1 1" : "0 1",
                transitionDelay: step >= 1 ? `${index * 120}ms` : "0ms",
              }}
            />
          </span>
          <Reveal at={2} step={step} className="tnum text-right">
            {source.clicks.toLocaleString("en-US")}
          </Reveal>
        </div>
      ))}
    </div>
  );
}

/** What a click leaves behind, a row at a time, and the one thing it never
 *  does: the IP address arrives struck through. */
function ClickRecord({ step }: { step: number }) {
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2.5 p-4">
      {RECORD.map(([term, value], index) => (
        <Reveal key={term} at={index + 1} step={step} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted">{term}</dt>
          <dd className={term === "Referrer" ? "font-mono" : undefined}>{value}</dd>
        </Reveal>
      ))}
      <Reveal at={4} step={step} className="col-span-2 grid grid-cols-subgrid">
        <dt className="text-muted">IP address</dt>
        <dd className="relative w-fit text-muted">
          never stored
          <span
            className="absolute inset-x-0 top-1/2 h-px origin-left bg-muted transition-[scale] duration-300 ease-out"
            style={{ scale: step >= 5 ? "1 1" : "0 1" }}
          />
        </dd>
      </Reveal>
    </dl>
  );
}

const RECORD = [
  ["Country", "Italy"],
  ["Referrer", "instagram.com"],
  ["Device", "Mobile"],
] as const;

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
