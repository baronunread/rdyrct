import { useEffect, useRef, useState, type RefObject } from "react";
import { MorphIcon } from "morphicons/react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { useToast } from "../ui/toast";
import { check, copy } from "../ui/icon-nodes";
import { MarketingLink } from "./marketing-link";

/** How long "Copied" stays after the last click. */
const COPIED_MS = 2000;

/** The coupon: what it is worth on the left, the code and its Copy on the
 * right, split by a dashed rule. */
function Ticket({
  code,
  copyRef,
  onCopied,
}: {
  code: string;
  copyRef: RefObject<HTMLButtonElement | null>;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      toast("Could not copy. Select the code and copy it by hand.", "error");
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    setCopied(true);
    onCopied();
  };

  return (
    <div className="flex items-stretch rounded-xl border border-dashed border-accent/50 bg-accent/[0.07]">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-4 pr-3 pl-4">
        <span className="text-2xl leading-tight font-bold text-text tabular-nums">20% off</span>
        <span className="text-xs text-muted">first 3 months of Hobby or Pro</span>
      </div>
      <div aria-hidden className="my-3 border-l border-dashed border-accent/50" />
      <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 py-3 pr-3 pl-4">
        <span className="font-mono text-base font-bold tracking-widest text-accent select-all">
          {code}
        </span>
        <Button ref={copyRef} size="sm" variant="outline" onClick={copyCode}>
          <MorphIcon
            icon={copied ? check : copy}
            size={14}
            spring="snappy"
            className={copied ? "text-accent-2" : undefined}
          />
          <span className="min-w-11 text-left">{copied ? "Copied" : "Copy"}</span>
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Code copied" : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * The exit offer's card (components/exit-offer.tsx decides when). Its own
 * chunk: most visitors never see it, so it loads only once the visitor has
 * been on the page long enough to be shown it.
 *
 * A coupon with the code on it (from /api/config) and a Copy control, "See
 * plans" and "No thanks". It never asks for an email address: the code is
 * on the card.
 *
 * Copying, "See plans" and "No thanks" all answer the card, so it
 * never shows again in this browser. Escape, the × or a click outside only
 * put it away for the 30 days it would have stayed away anyway.
 */
export default function ExitOfferCard({
  open,
  code,
  onCopied,
  onAccepted,
  onDecline,
  onDismiss,
}: {
  open: boolean;
  code: string;
  onCopied: () => void;
  /** "See plans": the card closes as the pricing page opens. */
  onAccepted: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const copyRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onDismiss()}
      title="Leaving already? Here’s 20% off"
      size="sm"
      initialFocus={copyRef}
    >
      <div className="flex flex-col gap-5">
        <p className="-mt-2 text-sm text-pretty text-muted">
          Use this code at checkout for your first 3 months of Hobby or Pro.
        </p>
        <Ticket code={code} copyRef={copyRef} onCopied={onCopied} />
        <MarketingLink
          to="/pricing"
          onClick={onAccepted}
          className={buttonClass({ variant: "primary", className: "w-full" })}
        >
          See plans
        </MarketingLink>
        <Button variant="ghost" className="-mt-2 self-center" onClick={onDecline}>
          No thanks
        </Button>
      </div>
    </Dialog>
  );
}
