/**
 * The app itself, right under the hero: three real screenshots behind a
 * segmented control, in the visitor's theme, with a phone-sized set below
 * 640px. The tabs advance on their own every few seconds until the visitor
 * picks one, hovers or focuses the section, or asked for less motion.
 *
 * The screenshots are taken from the seeded dev data by
 * scripts/showcase-shots.ts. Only the pictures for the current theme and
 * screen size are fetched (the others stay display:none and lazy).
 */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import type { EdgeLightProps } from "./hero-gpu-effects";
import { ChartIcon, GridIcon, LinkIcon } from "../ui/nav-icons";
import { cn } from "../ui/cn";
import { useHydrated } from "../lib/hydrated";
import { hasWebGpu } from "../lib/webgpu";

// Decoration: if its chunk fails to load (a deploy swapped it, a flaky
// network), the page goes on without it instead of falling to the error screen.
const EdgeLight = lazy<ComponentType<EdgeLightProps>>(() =>
  import("./hero-gpu-effects")
    .then((module) => ({ default: module.EdgeLight }))
    .catch(() => ({ default: () => null })),
);

const VIEWS = [
  {
    key: "dashboard",
    label: "Dashboard",
    Icon: GridIcon,
    caption: "See this week's clicks, your best links and what changed, on one page.",
  },
  {
    key: "analytics",
    label: "Analytics",
    Icon: ChartIcon,
    caption: "See where every click came from: country, website, campaign and device.",
  },
  {
    key: "links",
    label: "Links",
    Icon: LinkIcon,
    caption: "Keep every link on your own domain, each with its QR code and click count.",
  },
] as const;

/** How long each view stays before the next, when nobody has chosen one. */
const ADVANCE_MS = 7000;
const FRAME_RADIUS = 18;

export function ProductShowcase() {
  const hydrated = useHydrated();
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(false);
  const [held, setHeld] = useState(false);
  const view = VIEWS[index] ?? VIEWS[0];

  const rotating = hydrated && !chosen && !held;
  useEffect(() => {
    if (!rotating || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % VIEWS.length), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [rotating, index]);

  return (
    <section
      aria-label="The rdyrct app"
      // Clips the canvas light at the screen edge, not at the column: the negative
      // margin cancels page-column padding (1.5rem) so the glow reaches the sides.
      className="relative -mx-6 px-6 pt-4 pb-6 [overflow-x:clip] md:pt-8"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <ShowcaseTabs
        index={index}
        rotating={rotating}
        onPick={(i) => {
          setIndex(i);
          setChosen(true);
        }}
      />
      <p className="mx-auto mt-4 min-h-12 max-w-xl text-center text-base text-balance text-muted sm:min-h-6">
        {view.caption}
      </p>
      <ShowcaseFrame index={index} lit={hydrated && hasWebGpu()} />
    </section>
  );
}

/** The segmented control. The current tab carries a line that fills while
 *  the views advance on their own. */
function ShowcaseTabs({
  index,
  rotating,
  onPick,
}: {
  index: number;
  rotating: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Parts of the app"
      className="mx-auto flex w-max gap-0.5 rounded-xl border border-border bg-surface-2 p-1"
    >
      {VIEWS.map((v, i) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          id={`showcase-tab-${v.key}`}
          aria-selected={i === index}
          aria-controls="showcase-panel"
          onClick={() => onPick(i)}
          className={cn(
            "relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-text sm:px-4",
            i === index && "bg-surface text-text shadow-[0_0_0_1px_var(--border)]",
          )}
        >
          <v.Icon size={16} className="max-sm:hidden" />
          {v.label}
          {i === index && rotating && (
            <span
              aria-hidden="true"
              key={index}
              className="showcase-progress absolute inset-x-3 bottom-0.5 h-0.5 origin-left rounded-full bg-accent/70 motion-reduce:hidden"
              style={{ animationDuration: `${ADVANCE_MS}ms` }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

/** The screenshots in their frame, with the glow behind, the fade into the
 *  page below, and (where WebGPU exists) the light along the edge. */
function ShowcaseFrame({ index, lit }: { index: number; lit: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const view = VIEWS[index] ?? VIEWS[0];
  return (
    <div className="relative mx-auto mt-6 max-w-6xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[10%] -top-10 h-3/5 rounded-full bg-accent/15 blur-3xl"
      />
      <div
        ref={frame}
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${view.key}`}
        className="relative aspect-[1440/820] overflow-hidden border border-border bg-surface shadow-[0_40px_100px_-40px_rgb(0_0_0/0.45)] max-sm:aspect-[390/600]"
        style={{ borderRadius: FRAME_RADIUS }}
      >
        {VIEWS.map((v, i) => (
          <div
            key={v.key}
            className={cn(
              "absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none",
              i === index ? "opacity-100" : "opacity-0",
            )}
          >
            <ShowcaseImage name={v.key} label={`The ${v.label} page`} />
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-px h-1/4 bg-linear-to-b from-transparent to-bg"
      />
      {lit && (
        <Suspense>
          <EdgeLight frame={frame} radius={FRAME_RADIUS} />
        </Suspense>
      )}
    </div>
  );
}

/** One view's screenshots: dark and light, phone and desktop. CSS shows the
 *  one that matches; the rest are lazy and display:none, so never fetched. */
function ShowcaseImage({ name, label }: { name: string; label: string }) {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => (
        <picture key={theme} className={theme === "dark" ? "showcase-dark" : "showcase-light"}>
          <source media="(max-width: 639px)" srcSet={`/showcase/${name}-${theme}-phone.webp`} />
          <img
            src={`/showcase/${name}-${theme}.webp`}
            alt={label}
            loading="lazy"
            decoding="async"
            width={1440}
            height={820}
            className="block h-auto w-full"
          />
        </picture>
      ))}
    </>
  );
}
