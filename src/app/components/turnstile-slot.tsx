import type { TurnstileChallenge } from "../lib/turnstile";
import { cn } from "../ui/cn";

/**
 * Where Cloudflare's challenge appears, directly above a guarded form's
 * submit button (#304).
 *
 * Takes no space while the widget is invisible, which is nearly always: the
 * slot is out of the flow (absolute, zero size), so it is not a flex item
 * and adds no row and no gap to the form, even while Cloudflare's invisible
 * widget sits inside it solving. (`display: contents` was not enough: the
 * widget's own wrapper then became a flex item and pushed the form down by a
 * gap for the second the solve took.) When Cloudflare does want a click, the
 * slot becomes a full-width row and the widget fills it, clipped to the
 * inputs' corner radius so it reads as one of the form's fields rather than
 * something pinned on. Line height 0 drops the few pixels of baseline space
 * an inline iframe would otherwise leave under it.
 */
export function TurnstileSlot({
  challenge,
  className,
}: {
  challenge: TurnstileChallenge;
  /** Extra classes while the challenge shows, for a parent with no gap. */
  className?: string;
}) {
  return (
    <>
      <div
        ref={challenge.slotRef}
        data-turnstile-slot=""
        className={
          challenge.needsClick
            ? cn("w-full overflow-hidden rounded-md leading-0", className)
            : "absolute size-0 overflow-hidden"
        }
      />
      {/* Absolutely positioned (sr-only), so it is not a flex item either. */}
      <p role="status" className="sr-only">
        {challenge.needsClick ? "Cloudflare needs one click to check you are human." : ""}
      </p>
    </>
  );
}
