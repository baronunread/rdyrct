import { useRef } from "react";
import { cn } from "./cn";

export function LiveStatus({
  done,
  label,
  className,
  announce = true,
}: {
  done: boolean;
  label: string;
  className?: string;
  // Off inside a region that already announces (a role="status" around it), or it is said twice.
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
      <span key={label} className={cn("live-status-label", label !== firstLabel && "is-new")}>
        {label}
      </span>
    </span>
  );
}
