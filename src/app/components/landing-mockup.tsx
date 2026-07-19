import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  Copy,
  Link2,
  Loader2,
  MousePointerClick,
  QrCode,
} from "lucide-react";
import { QRPreview } from "./qr";
import { cn } from "../ui/cn";

const LONG_URL = "https://example.com/very/long/path?utm_campaign=launch";
const SHORT_URL = "rdyrct.com/launch";
const SHORT_HREF = `https://${SHORT_URL}`;
const BARS = [8, 14, 10, 18, 12, 22, 15, 26, 19, 30];

type Phase = "typing" | "submitting" | "result";

/** Small looping click sparkline: a row of bars with a subtle pulse. */
function ClickSparkline() {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-end gap-[5px]" aria-hidden="true">
      {BARS.map((h, i) => (
        <motion.div
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
 * code. The result zone keeps a constant height — a skeleton placeholder
 * mirrors the result's exact layout and crossfades in place — so the loop
 * never shifts the page layout. Built entirely from the app's own design
 * tokens so it stays theme-aware and CSP-safe (no images, no remote fonts).
 */
export function LandingMockup() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("typing");
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  // Self-playing loop: type the URL char by char → submit → show the result,
  // hold it, then reset. Reduced motion skips straight to the final state.
  useEffect(() => {
    if (reduce) {
      setTyped(LONG_URL);
      setPhase("result");
      return;
    }
    let id: number;
    if (phase === "typing") {
      if (typed.length < LONG_URL.length) {
        id = window.setTimeout(
          () => setTyped(LONG_URL.slice(0, typed.length + 1)),
          typed.length === 0 ? 600 : 24 + Math.random() * 46,
        );
      } else {
        id = window.setTimeout(() => setPhase("submitting"), 400);
      }
    } else if (phase === "submitting") {
      id = window.setTimeout(() => setPhase("result"), 800);
    } else {
      id = window.setTimeout(() => {
        setTyped("");
        setCopied(false);
        setPhase("typing");
      }, 4600);
    }
    return () => clearTimeout(id);
  }, [phase, typed, reduce]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SHORT_HREF);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable (permissions) — purely decorative anyway
    }
  };

  const isResult = phase === "result";

  return (
    <div className="w-full max-w-4xl rounded-2xl border border-border bg-surface shadow-2xl shadow-black/10">
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
        {/* the shorten form */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
            <Link2 size={14} /> Destination URL
          </p>
          <div className="flex gap-2">
            <div className="relative h-9 flex-1 overflow-hidden rounded-md border border-border bg-bg px-3 text-sm">
              <span className="flex h-full items-center truncate font-mono text-text">
                {typed}
                {phase === "typing" && (
                  <motion.span
                    aria-hidden="true"
                    className="ml-px inline-block h-4 w-[7px] shrink-0 bg-accent"
                    animate={reduce ? undefined : { opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                  />
                )}
                {phase !== "typing" && typed.length === 0 && (
                  <span className="text-muted/60">https://…</span>
                )}
              </span>
            </div>
            <motion.button
              type="button"
              aria-label="Shorten (demo)"
              animate={
                phase === "submitting" && !reduce
                  ? { scale: [1, 0.94, 1] }
                  : undefined
              }
              transition={{ duration: 0.3 }}
              className="inline-flex h-9 shrink-0 cursor-default items-center justify-center gap-2 rounded-md bg-accent px-3.5 text-sm font-bold text-bg"
            >
              {phase === "submitting" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ArrowRight size={15} />
              )}
              Shorten
            </motion.button>
          </div>
        </div>

        {/*
         * Result zone: both layers share one grid cell, so the panel height
         * is always the max of the two (identical layouts) — the crossfade
         * happens in place with zero layout shift.
         */}
        <div className="grid rounded-xl border border-border bg-bg/40 p-5">
          {/* skeleton placeholder, mirrors the result layout 1:1 */}
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
                <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">
                  Your short link
                </p>
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
                    <div
                      key={i}
                      className="w-[9px] rounded-sm bg-border/60"
                      style={{ height: h }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2 self-center">
              <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                <QrCode size={22} />
              </div>
              <p className="text-[11px] tracking-wide text-muted uppercase">
                QR included
              </p>
            </div>
          </div>

          {/* the real result */}
          <motion.div
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
              <div>
                <p className="mb-1.5 text-xs tracking-wide text-muted uppercase">
                  Your short link
                </p>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-base font-bold text-accent">
                    {SHORT_URL}
                  </span>
                  <button
                    type="button"
                    onClick={copy}
                    tabIndex={isResult ? 0 : -1}
                    aria-label="Copy short link"
                    className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    {copied ? (
                      <Check size={13} className="text-accent-2" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-xs tracking-wide text-muted uppercase">
                  <MousePointerClick size={14} /> Clicks (7d)
                </p>
                <ClickSparkline />
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2 self-center">
              <QRPreview url={SHORT_HREF} size={112} />
              <p className="text-[11px] tracking-wide text-muted uppercase">
                Scan me — it works
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
