import type { TurnstileChallenge } from "../lib/turnstile";
import { cn } from "../ui/cn";

// Out of the flow (absolute, zero size) so the invisible widget adds no row or gap.
// `display: contents` was not enough: the widget wrapper became a flex item.
export function TurnstileSlot({
  challenge,
  className,
}: {
  challenge: TurnstileChallenge;
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
      <p role="status" className="sr-only">
        {challenge.needsClick ? "Cloudflare needs one click to check you are human." : ""}
      </p>
    </>
  );
}
