/**
 * How a feature the plan lacks offers itself (the "Mix" pattern).
 *
 * A section inside a page shows its real controls, quieter and inert, with a
 * `PaidBadge` by its title and one upgrade action under it. A whole feature
 * keeps its normal button with the badge in it, and pressing that button
 * opens this dialog instead of the feature. Either way the person sees what
 * they would get before being asked to pay for it.
 *
 * Over-plan and locked states are a different message ("you have more than
 * you pay for") and stay with `OverLimitBanner` and `LockedPanel`.
 */
import { Check, Lock } from "@/app/ui/icons";
import { PLAN_PRICES } from "@/shared/types";
import { HrefLink } from "../lib/router-search";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";

/** "Paid", with a lock: this needs a paid plan. `onPrimary` for a badge that
 * sits inside a primary button, where the accent tint would vanish. */
export function PaidBadge({ onPrimary }: { onPrimary?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-semibold whitespace-nowrap",
        onPrimary
          ? "bg-[color-mix(in_oklab,var(--bg)_18%,transparent)] text-bg"
          : "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-accent",
      )}
    >
      {!onPrimary && <Lock size={11} aria-hidden />}
      Paid
    </span>
  );
}

/** One sentence with the prices of the plans that unlock the feature. */
function priceLine(unlockedBy: "hobby" | "pro"): string {
  return unlockedBy === "hobby"
    ? `Hobby is ${PLAN_PRICES.hobby} a month, Pro ${PLAN_PRICES.pro}. Cancel any time.`
    : `Pro is ${PLAN_PRICES.pro} a month. Cancel any time.`;
}

/**
 * What pressing a badged control opens: what the feature is, what it costs,
 * what it gives, and the way to the plans. `unlockedBy` is the cheapest plan
 * that includes it.
 */
export function UpgradeDialog({
  open,
  onClose,
  title,
  benefits,
  unlockedBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Three short lines, each a thing the plan gives. */
  benefits: string[];
  unlockedBy: "hobby" | "pro";
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <p className="-mt-2 text-sm text-pretty text-muted">{priceLine(unlockedBy)}</p>
        <ul className="flex flex-col gap-2 text-sm">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Check size={15} aria-hidden className="mt-0.5 shrink-0 text-accent-2" />
              {b}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <HrefLink href="/billing" className={buttonClass({ variant: "primary" })}>
            See plans
          </HrefLink>
        </div>
      </div>
    </Dialog>
  );
}
