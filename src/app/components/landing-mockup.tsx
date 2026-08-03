import { useEffect, useState } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  Copy,
  FileImage,
  ImagePlus,
  Link2,
  Loader2,
  MousePointerClick,
  QrCode,
} from "lucide-react";
import { QRPreview } from "./qr";
import { cn } from "../ui/cn";

const LONG_URL = "https://example.com/very/long/path?utm_campaign=launch";
// A custom-domain link: chosen slugs only exist on custom domains, so the
// hero must not depict one on the shared host.
const SHORT_URL = "go.acme.com/launch";
const SHORT_HREF = `https://${SHORT_URL}`;
// SVG mark for the fictional "Acme" brand — shows off the custom-logo
// feature. Served from /public so the browser caches it across loops.
const ACME_LOGO = "/acme.svg";
const BARS = [8, 14, 10, 18, 12, 22, 15, 26, 19, 30];

type Phase = "typing" | "submitting" | "result" | "uploading" | "branded";

/** Small looping click sparkline: a row of bars with a subtle pulse. */
function ClickSparkline() {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-end gap-[5px]" aria-hidden="true">
      {BARS.map((h, i) => (
        <m.div
          key={i}
          className="w-[9px] rounded-sm bg-accent-2/70"
          style={{ height: h }}
          initial={reduce ? undefined : { opacity: 0.5, scaleY: 0.6 }}
          animate={reduce ? undefined : { opacity: 1, scaleY: 1 }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            repeatType: "reverse",
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/**
 * Stylized, self-playing mockup of the link creator: a form "types" a long
 * URL, submits it, and gets back a short link plus its (real, scannable) QR
 * code; a logo then "uploads" into the dropzone and the QR rebrands with it.
 * The result zone keeps a constant height — a skeleton placeholder
 * mirrors the result's exact layout and crossfades in place — so the loop
 * never shifts the page layout. Built entirely from the app's own design
 * tokens so it stays theme-aware and CSP-safe (no remote images or fonts).
 */
/** Fixed-delay phase transitions: everything except "typing" (which paces
 * itself per character) and "branded" (which also resets typed/copied). */
const PHASE_ADVANCE: Partial<Record<Phase, { delay: number; next: Phase }>> = {
  submitting: { delay: 800, next: "result" },
  result: { delay: 1800, next: "uploading" },
  uploading: { delay: 1500, next: "branded" },
};

/** Schedules the next keystroke, or the move to "submitting" once fully typed. */
function scheduleTyping(
  typed: string,
  setTyped: (v: string) => void,
  setPhase: (p: Phase) => void,
) {
  if (typed.length < LONG_URL.length) {
    return window.setTimeout(
      () => setTyped(LONG_URL.slice(0, typed.length + 1)),
      typed.length === 0 ? 600 : 24 + Math.random() * 46,
    );
  }
  return window.setTimeout(() => setPhase("submitting"), 400);
}

function useAutoPlay() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("typing");
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (reduce) {
      setTyped(LONG_URL);
      setPhase("branded");
      return;
    }
    if (phase === "typing") {
      const id = scheduleTyping(typed, setTyped, setPhase);
      return () => clearTimeout(id);
    }
    if (phase === "branded") {
      const id = window.setTimeout(() => {
        setTyped("");
        setCopied(false);
        setPhase("typing");
      }, 4200);
      return () => clearTimeout(id);
    }
    const step = PHASE_ADVANCE[phase];
    if (!step) return;
    const id = window.setTimeout(() => setPhase(step.next), step.delay);
    return () => clearTimeout(id);
  }, [phase, typed, reduce]);

  return {
    phase,
    typed,
    setTyped,
    copied,
    setCopied,
    reduce,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(SHORT_HREF);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      } catch {
        // clipboard unavailable
      }
    },
  };
}

type Reduce = ReturnType<typeof useReducedMotion>;

/** The typed text, blinking cursor (while typing), and placeholder — the
 * part of the URL field whose content depends on phase. */
function TypedUrlDisplay({
  phase,
  typed,
  reduce,
}: {
  phase: Phase;
  typed: string;
  reduce: Reduce;
}) {
  return (
    <span className="flex h-full items-center truncate font-mono text-text">
      {typed}
      {phase === "typing" && (
        <m.span
          aria-hidden="true"
          className="ml-px inline-block h-4 w-[7px] shrink-0 bg-accent"
          animate={reduce ? undefined : { opacity: [1, 0, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
      )}
      {phase !== "typing" && typed.length === 0 && <span className="text-muted/60">https://…</span>}
    </span>
  );
}

/** The "type a URL, hit shorten" form at the top of the mockup. */
function ShortenFormMock({
  phase,
  typed,
  reduce,
}: {
  phase: Phase;
  typed: string;
  reduce: Reduce;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
        <Link2 size={14} /> Destination URL
      </p>
      <div className="flex gap-2">
        <div className="relative h-9 flex-1 overflow-hidden rounded-md border border-border bg-bg px-3 text-sm">
          <TypedUrlDisplay phase={phase} typed={typed} reduce={reduce} />
        </div>
        <m.button
          type="button"
          aria-label="Shorten (demo)"
          animate={phase === "submitting" && !reduce ? { scale: [1, 0.94, 1] } : undefined}
          transition={{ duration: 0.3 }}
          className="inline-flex h-9 shrink-0 cursor-default items-center justify-center gap-2 rounded-md bg-accent px-3.5 text-sm font-bold text-bg"
        >
          {phase === "submitting" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ArrowRight size={15} />
          )}
          Shorten
        </m.button>
      </div>
    </div>
  );
}

/** Skeleton placeholder mirroring the result panel's layout 1:1, shown
 * before the mockup has a "result" to crossfade in. */
function ResultSkeleton({ isResult, phase }: { isResult: boolean; phase: Phase }) {
  return (
    <div
      aria-hidden={isResult}
      className={cn(
        "col-start-1 row-start-1 flex flex-col gap-6 transition-opacity duration-300 sm:flex-row sm:items-center",
        isResult ? "opacity-0" : "opacity-100",
        phase === "submitting" && "animate-pulse",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">Your short link</p>
          <div className="flex h-7 items-center">
            <span className="h-3.5 w-44 max-w-full rounded bg-border/70" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
            <MousePointerClick size={14} /> Clicks (7d)
          </p>
          <div className="flex items-end gap-[5px]" aria-hidden="true">
            {BARS.map((h, i) => (
              <div key={i} className="w-[9px] rounded-sm bg-border/60" style={{ height: h }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
            <ImagePlus size={14} /> QR logo
          </p>
          <div className="h-11 rounded-md border border-dashed border-border/70" />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 self-center">
        <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-dashed border-border text-muted">
          <QrCode size={28} />
        </div>
        <p className="text-2xs tracking-wide text-muted uppercase">QR included</p>
      </div>
    </div>
  );
}

function UploadingLogo({ reduce }: { reduce: Reduce }) {
  return (
    <m.div
      initial={reduce ? undefined : { y: -26, opacity: 0 }}
      animate={reduce ? undefined : { y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="flex items-center gap-2"
    >
      <FileImage size={14} />
      <span className="font-mono text-text">acme.svg</span>
      <Loader2 size={13} className="animate-spin text-accent" />
    </m.div>
  );
}

function BrandedLogo({ reduce }: { reduce: Reduce }) {
  return (
    <m.div
      initial={reduce ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2"
    >
      <Check size={14} className="text-accent-2" />
      <span className="font-mono text-text">acme.svg</span>
      <span>logo added</span>
    </m.div>
  );
}

function EmptyLogoHint() {
  return (
    <span>
      Drop an image or <span className="text-accent">browse</span>
    </span>
  );
}

/** The fake logo dropzone inside the result panel: idle, "uploading", then
 * "branded" once the logo lands. */
function ResultLogoZone({ phase, reduce }: { phase: Phase; reduce: Reduce }) {
  return (
    <div className="flex h-11 items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed border-border px-3 text-xs text-muted">
      {phase === "uploading" ? (
        <UploadingLogo reduce={reduce} />
      ) : phase === "branded" ? (
        <BrandedLogo reduce={reduce} />
      ) : (
        <EmptyLogoHint />
      )}
    </div>
  );
}

/** The short link + copy button row at the top of the result panel. */
function ShortLinkRow({
  isResult,
  copied,
  copy,
}: {
  isResult: boolean;
  copied: boolean;
  copy: () => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">Your short link</p>
      <div className="flex items-center gap-2">
        {/* A working demo of the redirect: the "short link" opens
         * the typed destination in a new tab, just like the real
         * thing would. */}
        <a
          href={LONG_URL}
          target="_blank"
          rel="noreferrer"
          tabIndex={isResult ? 0 : -1}
          className="truncate font-mono text-base font-bold text-accent hover:underline"
        >
          {SHORT_URL}
        </a>
        <button
          type="button"
          onClick={copy}
          tabIndex={isResult ? 0 : -1}
          aria-label="Copy short link"
          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-accent hover:text-accent"
        >
          {copied ? <Check size={13} className="text-accent-2" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

/** Shared crossfade layer: `active` picks visibility and a11y for one of
 * the two same-position QR variants in <QrCrossfade>. */
function qrLayerProps(active: boolean) {
  return {
    "aria-hidden": !active,
    className: cn(
      "col-start-1 row-start-1 transition-opacity duration-300",
      active ? "opacity-100" : "opacity-0",
    ),
  };
}

/** Both QR variants stay mounted and crossfade: updating one instance's
 * `image` would make qr-code-styling re-load the logo on every loop. */
function QrCrossfade({ phase, reduce }: { phase: Phase; reduce: Reduce }) {
  const branded = phase === "branded";
  return (
    <m.div
      animate={branded && !reduce ? { scale: [1, 1.04, 1] } : undefined}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="grid"
    >
      <div {...qrLayerProps(!branded)}>
        <QRPreview url={SHORT_HREF} size={160} />
      </div>
      <div {...qrLayerProps(branded)}>
        <QRPreview url={SHORT_HREF} logo={ACME_LOGO} size={160} />
      </div>
    </m.div>
  );
}

/** Real result panel: the short link, click sparkline, logo dropzone and QR
 * preview. */
function ResultPanel({
  phase,
  isResult,
  copied,
  copy,
  reduce,
}: {
  phase: Phase;
  isResult: boolean;
  copied: boolean;
  copy: () => void;
  reduce: Reduce;
}) {
  return (
    <m.div
      aria-hidden={!isResult}
      initial={false}
      animate={isResult ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn(
        "col-start-1 row-start-1 flex flex-col gap-6 sm:flex-row sm:items-center",
        !isResult && "pointer-events-none",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <ShortLinkRow isResult={isResult} copied={copied} copy={copy} />
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
            <MousePointerClick size={14} /> Clicks (7d)
          </p>
          <ClickSparkline />
        </div>
        {/* fake logo dropzone: a file "drops in", then the QR rebrands */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
            <ImagePlus size={14} /> QR logo
          </p>
          <ResultLogoZone phase={phase} reduce={reduce} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 self-center">
        <QrCrossfade phase={phase} reduce={reduce} />
        <p className="text-2xs tracking-wide text-muted uppercase">Scan me, it works</p>
      </div>
    </m.div>
  );
}

export function LandingMockup() {
  const { phase, typed, copied, copy, reduce } = useAutoPlay();

  const isResult = phase === "result" || phase === "uploading" || phase === "branded";

  return (
    <LazyMotion features={domAnimation}>
      <div className="w-full max-w-4xl rounded-2xl bg-surface smooth-shadow-ring-2xl">
        {/* fake browser chrome */}
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <span className="h-3 w-3 rounded-full bg-pink/60" />
          <span className="h-3 w-3 rounded-full bg-butter/60" />
          <span className="h-3 w-3 rounded-full bg-mint/60" />
          <span className="ml-3 flex-1 truncate rounded-md bg-surface-2 px-3 py-1.5 text-xs text-muted">
            rdyrct.com/links
          </span>
        </div>

        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <ShortenFormMock phase={phase} typed={typed} reduce={reduce} />

          {/*
           * Result zone: both layers share one grid cell, so the panel height
           * is always the max of the two (identical layouts) — the crossfade
           * happens in place with zero layout shift.
           */}
          <div className="grid rounded-xl border border-border bg-bg/40 p-5">
            <ResultSkeleton isResult={isResult} phase={phase} />
            <ResultPanel
              phase={phase}
              isResult={isResult}
              copied={copied}
              copy={copy}
              reduce={reduce}
            />
          </div>
        </div>
      </div>
    </LazyMotion>
  );
}
