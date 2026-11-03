import { useRef } from "react";
import { cn } from "./cn";

/**
 * Something the app is checking right now and will settle on its own: a
 * domain's DNS, a payment Polar has not confirmed, an assistant still
 * connecting (rdyrct-design, "A live status is a dot"). While it checks, an
 * amber dot ripples and the label shimmers; when it settles the dot turns
 * mint, one ring bursts out, and the label crossfades to the result.
 *
 * Settled from the first render means it was already done when the page
 * opened, so nothing plays. The motion lives in styles.css (`live-status`),
 * which also stills it under reduced motion.
 */
export function LiveStatus({
  done,
  label,
  className,
  announce = true,
}: {
  /** Whether the check has settled. */
  done: boolean;
  /** What it says: present tense while checking ("Checking DNS"), the
   * result once done ("Live"). */
  label: string;
  className?: string;
  /** Say the change aloud when it settles. Off inside a region that
   *  already announces (a role="status" around it), or it is said twice. */
  announce?: boolean;
}) {
  // What it said on arrival, read once and never set: a status already
  // settled then has no news, and the first label renders still.
  const arrival = useRef({ done, label }).current;
  const doneOnArrival = arrival.done;
  const firstLabel = arrival.label;
  return (
    <span
      aria-live={announce ? "polite" : undefined}
      className={cn(
        "live-status",
        done && "live-status-done",
        done && doneOnArrival && "live-status-settled",
        className,
      )}
    >
      <span aria-hidden className="live-status-dot" />
      {/* Keyed on the label so a change remounts it and crossfades in; the
          first label renders still. */}
      <span key={label} className={cn("live-status-label", label !== firstLabel && "is-new")}>
        {label}
      </span>
    </span>
  );
}
