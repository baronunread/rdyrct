/**
 * The product tour under the hero: the dashboard, the links table and the
 * analytics page, playing through the thing a visitor would do on their first
 * day (make a link, see it listed, see what it did).
 *
 * Built from the app's own pieces (the nav items, the UI kit, the real chart
 * components) over sample data, so it cannot drift into a picture of a
 * product that does not exist. It plays only while it is on screen, and a
 * visitor who asked for less motion gets each screen in its finished state.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { useInView, useReducedMotion } from "motion/react";
import { appNavItems } from "./nav-items";
import { Card, Table, Th, Td } from "../ui/misc";
import { Spinner } from "../ui/spinner";
import { Copy } from "../ui/icons";
import { cn } from "../ui/cn";

// The analytics screen draws with the real chart components, which are the
// largest thing the homepage can fetch. They load when the tour moves past
// its first screen, never for a visitor who reads the hero and leaves.
const AnalyticsScreen = lazy(() =>
  import("./landing-analytics").then((m) => ({ default: m.LandingAnalyticsMock })),
);
// The same lazy QR the hero uses: a failed load shows no code rather than
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

const STEPS = [
  { label: "Create a link", path: "/dashboard", nav: "/dashboard" },
  { label: "Share it", path: "/links", nav: "/links" },
  { label: "See what worked", path: "/analytics", nav: "/analytics" },
] as const;

/** How long each screen stays up before the tour moves on. */
const STEP_MS = 8000;

const NEW_LINK = {
  host: "go.northwind.co",
  slug: "k7m2xqp",
  destination: "https://shop.northwind.co/collections/linen",
};
const NEW_URL = `${NEW_LINK.host}/${NEW_LINK.slug}`;

/** Resolves after `ms`, or never once `signal` has aborted, so a scene that
 * lost the screen stops where it is instead of writing into the next one. */
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => clearTimeout(t));
  });
}

/** Runs a scene's script while `playing`, aborting it when that stops. */
function useScript(playing: boolean, script: (signal: AbortSignal) => Promise<void>) {
  const ref = useRef(script);
  ref.current = script;
  useEffect(() => {
    if (!playing) return;
    const ctrl = new AbortController();
    void ref.current(ctrl.signal);
    return () => ctrl.abort();
  }, [playing]);
}

/** The step on screen, moving on by itself while the tour is in view and
 * the visitor has not asked for less motion. */
function useAutoStep(running: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [step, running]);
  return [step, setStep] as const;
}

/** False until `when` is first true, then true for good. */
function useLatch(when: boolean) {
  const [latched, setLatched] = useState(false);
  if (when && !latched) setLatched(true);
  return latched;
}

export function ProductTour({ footer }: { footer?: ReactNode }) {
  const win = useRef<HTMLDivElement>(null);
  const inView = useInView(win, { amount: 0.3 });
  const still = useReducedMotion() ?? false;
  const running = inView && !still;
  const [step, setStep] = useAutoStep(running);

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Product tour" className="grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => (
          <TourTab
            key={s.label}
            label={`${i + 1}. ${s.label}`}
            selected={step === i}
            running={running}
            onSelect={() => setStep(i)}
          />
        ))}
      </div>

      <div
        ref={win}
        className="overflow-hidden rounded-2xl border border-border bg-bg smooth-shadow-ring-2xl"
      >
        <div className="flex items-center border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="mx-auto rounded-md bg-surface px-3 py-0.5 font-mono text-xs text-muted">
            rdyrct.com{STEPS[step].path}
          </span>
        </div>
        <div className="tour-window grid">
          <TourSidebar active={STEPS[step].nav} />
          <TourScreens step={step} inView={inView} still={still} />
        </div>
      </div>
      <p className="text-xs text-muted">An example organization, with sample figures.</p>
      {footer}
    </div>
  );
}

function TourScreens({ step, inView, still }: { step: number; inView: boolean; still: boolean }) {
  // The analytics bundle is wanted from the second screen on, so it has the
  // whole of that screen to arrive. Once asked for, it stays.
  const wantCharts = useLatch(step > 0);
  const playing = (i: number) => step === i && inView;
  return (
    <div className="relative grid min-w-0 overflow-hidden p-5 md:p-6">
      <Scene on={step === 0}>
        <DashboardScene playing={playing(0)} still={still} />
      </Scene>
      <Scene on={step === 1}>
        <LinksScene playing={playing(1)} still={still} />
      </Scene>
      <Scene on={step === 2}>
        {wantCharts && (
          <Suspense fallback={null}>
            <AnalyticsScreen />
          </Suspense>
        )}
      </Scene>
    </div>
  );
}

/** One step's tab. Its bar fills over the step's time, and pauses with the
 * tour when it leaves the screen. */
function TourTab({
  label,
  selected,
  running,
  onSelect,
}: {
  label: string;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className="flex cursor-pointer flex-col gap-1.5 text-left text-sm font-medium text-muted hover:text-text aria-selected:text-text"
    >
      {label}
      <span className="h-0.5 overflow-hidden rounded-full bg-border">
        {selected && (
          <span
            className="tour-progress block h-full bg-accent"
            style={{
              animationDuration: `${STEP_MS}ms`,
              animationPlayState: running ? "running" : "paused",
            }}
          />
        )}
      </span>
    </button>
  );
}

/** Every screen stays mounted in the same grid cell and cross-fades, so the
 * window never changes height between them. */
function Scene({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "col-start-1 row-start-1 flex min-w-0 flex-col gap-3 transition-opacity duration-300",
        on ? "opacity-100" : "invisible opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function TourSidebar({ active }: { active: string }) {
  return (
    <aside className="hidden flex-col gap-3 border-r border-border px-3 pt-4 md:flex">
      <span className="px-1.5 font-mono text-sm font-bold">rdyrct</span>
      <span className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm">
        Northwind
      </span>
      <ul className="flex flex-col gap-0.5">
        {appNavItems.map(({ to, icon: Icon, label }) => (
          <li
            key={to}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
              to === active ? "bg-surface-2 text-accent" : "text-muted",
            )}
          >
            <Icon size={15} />
            {label}
          </li>
        ))}
      </ul>
      <span className="-mx-3 mt-auto border-t border-border px-4 py-3 text-sm">Ana Ruiz</span>
    </aside>
  );
}

function ScreenHeader({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-lg font-bold">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      {right}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value}</p>
      {delta && <p className="tnum mt-1 text-xs text-accent-2">{delta}</p>}
    </Card>
  );
}

type Click = { slug: string; referrer: string; meta: string };
const CLICKS: Click[] = [
  { slug: "summer-ig", referrer: "instagram.com", meta: "IT · mobile · 1 minute ago" },
  { slug: "care", referrer: "direct", meta: "DE · desktop · 2 minutes ago" },
  { slug: "p8kd2mq", referrer: "linkedin.com", meta: "US · mobile · 4 minutes ago" },
  { slug: "podcast", referrer: "direct", meta: "FR · mobile · 6 minutes ago" },
];
type Activity = { who: string; slug: string; when: string };
const ACTIVITY: Activity[] = [
  { who: "Marco Bellini", slug: "summer-ig", when: "yesterday" },
  { who: "Dana Park", slug: "care", when: "yesterday" },
  { who: "Ana Ruiz", slug: "podcast", when: "2 days ago" },
];
const ARRIVALS: Click[] = [
  { slug: NEW_LINK.slug, referrer: "newsletter", meta: "IT · mobile · just now" },
  { slug: NEW_LINK.slug, referrer: "newsletter", meta: "DE · desktop · just now" },
  { slug: NEW_LINK.slug, referrer: "direct", meta: "IT · mobile · just now" },
];

type Phase = "idle" | "typing" | "busy" | "created" | "done";

/** Types `text` into `set` two characters at a time, like a quick paste. */
async function typeOut(text: string, set: (v: string) => void, signal: AbortSignal) {
  for (let i = 2; i <= text.length + 1; i += 2) {
    set(text.slice(0, i));
    await wait(24, signal);
  }
}

/** The dashboard's script: paste a link, create it, see the dialog, then
 * watch its first clicks arrive. */
function useDashboardScript(playing: boolean, still: boolean) {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>(still ? "done" : "idle");
  const [clicks, setClicks] = useState(CLICKS);

  useScript(playing && !still, async (signal) => {
    setTyped("");
    setPhase("idle");
    setClicks(CLICKS);
    await wait(600, signal);
    setPhase("typing");
    await typeOut(NEW_LINK.destination, setTyped, signal);
    await wait(250, signal);
    setPhase("busy");
    await wait(550, signal);
    setTyped("");
    setPhase("created");
    await wait(2300, signal);
    setPhase("done");
    for (const click of ARRIVALS) {
      await wait(900, signal);
      setClicks((c) => [click, ...c].slice(0, CLICKS.length));
    }
  });
  return { typed, phase, clicks };
}

function DashboardScene({ playing, still }: { playing: boolean; still: boolean }) {
  const { typed, phase, clicks } = useDashboardScript(playing, still);
  const made = phase === "done";
  return (
    <>
      <ScreenHeader title="Dashboard" sub="See your organization's link activity at a glance" />
      <QuickCreate typed={typed} phase={phase} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Links" value={made ? "42" : "41"} />
        <Stat label="Clicks · 7d" value="1.3k" delta="+18%" />
        <Stat label="Members" value="4" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <RecentClicks clicks={clicks} />
        <MemberActivity made={made} />
      </div>
      {phase === "created" && <CreatedDialog />}
    </>
  );
}

function QuickCreate({ typed, phase }: { typed: string; phase: Phase }) {
  return (
    <Card className="flex items-center gap-2 p-2.5">
      <span
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-bg px-3 text-sm",
          phase === "typing" ? "border-accent" : "border-border",
        )}
      >
        {typed || <span className="text-placeholder">https://example.com/launch</span>}
      </span>
      <span className="hidden h-9 w-40 items-center rounded-md border border-border bg-bg px-3 text-sm sm:flex">
        {NEW_LINK.host}
      </span>
      <span className="flex h-9 w-28 items-center justify-center rounded-md bg-accent text-sm font-medium text-bg">
        {phase === "busy" ? <Spinner /> : "Create link"}
      </span>
    </Card>
  );
}

function RecentClicks({ clicks }: { clicks: Click[] }) {
  return (
    <Card className="p-3">
      <p className="mb-2 text-xs font-medium text-muted">Recent clicks</p>
      <ul className="flex flex-col gap-1.5">
        {clicks.map((c, i) => (
          <li
            key={`${c.slug}-${c.meta}-${clicks.length - i}`}
            className="tour-row-in flex justify-between gap-3 text-xs"
          >
            <span className="min-w-0 truncate">
              <span className="text-accent">/{c.slug}</span>
              <span className="text-muted"> · {c.referrer}</span>
            </span>
            <span className="tnum shrink-0 text-muted">{c.meta}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MemberActivity({ made }: { made: boolean }) {
  const activity = made
    ? [{ who: "Ana Ruiz", slug: NEW_LINK.slug, when: "just now" }, ...ACTIVITY]
    : ACTIVITY;
  return (
    <Card className="hidden p-3 lg:block">
      <p className="mb-2 text-xs font-medium text-muted">Member activity</p>
      <ul className="flex flex-col gap-1.5">
        {activity.map((a) => (
          <li key={`${a.who}-${a.slug}`} className="tour-row-in flex justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-bold">{a.who}</span> created{" "}
              <span className="text-accent">/{a.slug}</span>
            </span>
            <span className="shrink-0 text-muted">{a.when}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The app's own "Link created" dialog, drawn in place rather than opened
 * as a real one, so it traps no focus on a page that is only showing it. */
function CreatedDialog() {
  return (
    <div className="tour-fade absolute inset-0 z-10 grid place-items-center bg-black/40">
      <div className="flex w-72 flex-col items-center gap-3 rounded-xl bg-surface p-5 smooth-shadow-ring-2xl">
        <p className="self-start font-bold">Link created</p>
        <Suspense fallback={<div className="size-44" />}>
          <QRPreview url={`https://${NEW_URL}`} size={176} />
        </Suspense>
        <p className="flex items-center gap-2 font-mono text-sm font-bold">
          {NEW_URL} <Copy size={14} className="text-muted" />
        </p>
      </div>
    </div>
  );
}

type Row = {
  host: string;
  slug: string;
  title: string;
  dest: string;
  clicks: number;
  created: string;
};
const ROWS: Row[] = [
  {
    host: "go.northwind.co",
    slug: "summer-ig",
    title: "Summer lookbook",
    dest: "https://shop.northwind.co/summer",
    clicks: 412,
    created: "Sep 22, 2026",
  },
  {
    host: "go.northwind.co",
    slug: "care",
    title: "Linen care",
    dest: "https://shop.northwind.co/care",
    clicks: 298,
    created: "Sep 18, 2026",
  },
  {
    host: "rdyrct.com",
    slug: "p8kd2mq",
    title: "Press kit",
    dest: "https://northwind.co/press",
    clicks: 96,
    created: "Sep 12, 2026",
  },
  {
    host: "go.northwind.co",
    slug: "podcast",
    title: "Podcast offer",
    dest: "https://shop.northwind.co/pod",
    clicks: 187,
    created: "Sep 3, 2026",
  },
  {
    host: "go.northwind.co",
    slug: "xmas25",
    title: "Christmas",
    dest: "https://shop.northwind.co/xmas",
    clicks: 12,
    created: "Dec 1, 2025",
  },
];

function LinksScene({ playing, still }: { playing: boolean; still: boolean }) {
  const [shown, setShown] = useState(still);
  const [count, setCount] = useState(3);

  useScript(playing && !still, async (signal) => {
    setShown(false);
    setCount(0);
    await wait(600, signal);
    setShown(true);
    for (let n = 1; n < 40; n++) {
      await wait(900, signal);
      setCount(n * 2);
    }
  });

  const rows = shown
    ? [
        {
          host: NEW_LINK.host,
          slug: NEW_LINK.slug,
          title: "",
          dest: NEW_LINK.destination,
          clicks: count,
          created: "Sep 25, 2026",
        },
        ...ROWS,
      ]
    : ROWS;

  return (
    <>
      <ScreenHeader
        title="Links"
        sub="Short links, UTM tagging and QR codes"
        right={<span className="tnum text-xs text-muted">{shown ? 42 : 41} / 500 links</span>}
      />
      <Table>
        <thead>
          <tr>
            <Th>Short link</Th>
            <Th className="hidden sm:table-cell">Title</Th>
            <Th className="hidden lg:table-cell">Destination</Th>
            <Th className="text-right">Clicks</Th>
            <Th className="hidden sm:table-cell">Created</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug} className={r.slug === NEW_LINK.slug ? "tour-row-new" : undefined}>
              <Td>
                <span className="block font-mono text-2xs text-muted">{r.host}</span>
                <span className="font-mono font-bold text-accent">/{r.slug}</span>
              </Td>
              <Td className="hidden sm:table-cell">{r.title}</Td>
              <Td className="hidden max-w-48 truncate font-mono text-xs lg:table-cell">{r.dest}</Td>
              <Td className="tnum text-right">{r.clicks}</Td>
              <Td className="hidden whitespace-nowrap sm:table-cell">{r.created}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
