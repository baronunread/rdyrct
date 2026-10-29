/**
 * How a feature the plan lacks offers itself.
 *
 * A whole page the plan does not include (Domains on Free) says so once, in
 * a locked state with one way to the plans. A setting the plan cannot save
 * (QR code defaults on Free) stays fully usable to try, and saving it opens
 * the plan picker, which goes straight to checkout.
 *
 * Billing is the owner's, so anyone else is told who can upgrade instead of
 * being handed a button that would upgrade their own account and change
 * nothing here. Over-plan and locked states are a different message ("you
 * have more than you pay for") and stay with `OverLimitBanner` and
 * `LockedPanel`.
 */
import { useState, type ReactNode } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Lock } from "@/app/ui/icons";
import { PLAN_LIMITS, PLAN_PRICES } from "@/shared/types";
import { useCheckout, useMembers } from "../lib/hooks";
import { HrefLink } from "../lib/router-search";
import posthog from "../lib/posthog";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";

type PaidPlan = "hobby" | "pro";

/** Who pays for this org, to go in front of " can …": "Luca Toth, the
 * owner," once the member list is in, else "the owner". */
export function useOwnerLabel(orgId: string): string {
  const members = useMembers(orgId);
  const owner = members.data?.find((m) => m.role === "owner");
  const name = owner?.name || owner?.email;
  return name ? `${name}, the owner,` : "the owner";
}

/**
 * A page the plan does not include: a lock, what the feature is on, one line
 * on what it does, and "See plans" for the owner (who pays), or who can
 * upgrade for anyone else.
 */
export function FeatureLocked({
  title,
  line,
  isOwner,
  ownerNote,
}: {
  title: string;
  line: ReactNode;
  isOwner: boolean;
  /** What anyone but the owner reads instead of the button. */
  ownerNote: string;
}) {
  return (
    <div
      data-testid="feature-locked"
      className="flex flex-col items-start gap-4 rounded-xl bg-surface px-5 py-6 smooth-shadow-ring-xs sm:flex-row sm:items-center"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"
      >
        <Lock size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-balance">{title}</p>
        <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted">{line}</p>
        {!isOwner && <p className="mt-2 text-sm text-muted">{ownerNote}</p>}
      </div>
      {isOwner && (
        <HrefLink
          href="/billing"
          className={buttonClass({ variant: "primary", className: "shrink-0 max-sm:w-full" })}
        >
          See plans
        </HrefLink>
      )}
    </div>
  );
}

/** What brought someone to the picker: that fact is the one emphasised. */
type Reason = "qr" | "domains";

function planFacts(plan: PaidPlan): { key: Reason | "other"; text: string }[] {
  const l = PLAN_LIMITS[plan];
  const n = (count: number) => count.toLocaleString("en-US");
  return [
    { key: "domains", text: `${l.domains} custom domain${l.domains === 1 ? "" : "s"}` },
    { key: "qr", text: "QR styles" },
    { key: "other", text: `${n(l.links)} links` },
    { key: "other", text: `${l.members} members` },
    ...(l.orgs > 1 ? [{ key: "other" as const, text: `${l.orgs} organizations` }] : []),
  ];
}

/**
 * Hobby and Pro side by side with their prices and what each gives, Hobby
 * picked, and checkout for the one picked. `onCheckout` runs just before the
 * browser leaves, for whatever has to survive the trip (a tried QR style).
 */
export function PlanPickerDialog({
  open,
  onClose,
  title,
  why,
  reason,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  why: string;
  reason: Reason;
  onCheckout?: (plan: PaidPlan) => void;
}) {
  const [plan, setPlan] = useState<PaidPlan>("hobby");
  const [leaving, setLeaving] = useState(false);
  const checkout = useCheckout();
  const toast = useToast();

  const go = async () => {
    posthog.capture("checkout_started", { target_plan: plan, interval: "month", from: reason });
    setLeaving(true);
    try {
      const { url } = await checkout.mutateAsync({ plan, interval: "month" });
      onCheckout?.(plan);
      window.location.assign(url);
    } catch (e) {
      setLeaving(false);
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={title} size="md">
      <div className="flex flex-col gap-4">
        <p className="-mt-2 text-sm text-pretty text-muted">{why}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Plan</legend>
          {(["hobby", "pro"] as const).map((p) => (
            <label
              key={p}
              className={cn(
                "grid cursor-pointer grid-cols-[16px_1fr_auto] items-baseline gap-x-2.5 gap-y-1 rounded-[11px] px-3.5 py-3 transition-[box-shadow,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                plan === p
                  ? "bg-accent/6 shadow-[0_0_0_1.5px_var(--accent)]"
                  : "smooth-shadow-ring-xs",
              )}
            >
              <input
                type="radio"
                name="plan"
                value={p}
                checked={plan === p}
                onChange={() => setPlan(p)}
                className="translate-y-0.5 accent-accent focus-visible:outline-none"
              />
              <span className="font-semibold">{p === "hobby" ? "Hobby" : "Pro"}</span>
              <span className="tnum text-sm">
                {PLAN_PRICES[p]} <span className="text-xs text-muted">a month</span>
              </span>
              <ul className="col-span-2 col-start-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
                {planFacts(p).map((f) => (
                  <li key={f.text} className={cn(f.key === reason && "font-medium text-text")}>
                    {f.text}
                  </li>
                ))}
              </ul>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
          <HrefLink
            href="/billing"
            className="mr-auto text-sm text-muted underline decoration-from-font underline-offset-2 max-sm:mx-auto max-sm:py-2 [@media(hover:hover)]:hover:text-text"
          >
            Compare every plan
          </HrefLink>
          <Button variant="ghost" onClick={onClose} disabled={leaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} disabled={leaving}>
            <BusyContent busy={leaving}>Continue to checkout</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
