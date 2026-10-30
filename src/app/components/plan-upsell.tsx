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
import { useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Check, Lock } from "@/app/ui/icons";
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

/** What brought someone to the picker: that fact leads each card. */
type Reason = "qr" | "domains";

const PLAN_NAMES = { hobby: "Hobby", pro: "Pro" } as const;

/** Four facts per plan, the one that brought them here first. Each fits
 * one line of a card. */
function planFacts(plan: PaidPlan, reason: Reason): string[] {
  const l = PLAN_LIMITS[plan];
  const n = (count: number) => count.toLocaleString("en-US");
  const domains = `${l.domains} custom domain${l.domains === 1 ? "" : "s"}`;
  const qr = "QR style on every code";
  const orgs = `${l.orgs} organization${l.orgs === 1 ? "" : "s"}`;
  const [lead, next] = reason === "qr" ? [qr, domains] : [domains, qr];
  return [lead, next, `${n(l.links)} links`, orgs];
}

/**
 * Hobby and Pro as two cards to pick from, each with its price and four
 * facts, Hobby picked; the button names the plan and goes to its checkout.
 * `onCheckout` runs just before the browser leaves, for whatever has to
 * survive the trip (a tried QR style).
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
  const cta = useRef<HTMLButtonElement>(null);

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
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      size="lg"
      initialFocus={cta}
    >
      <div className="flex flex-col gap-5">
        <p className="-mt-2 text-sm text-pretty text-muted">{why}</p>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Plan</legend>
          {(["hobby", "pro"] as const).map((p) => {
            const on = plan === p;
            return (
              // A native radio in each card: one Tab stop, arrows move between them.
              <label
                key={p}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-3 rounded-xl p-4 text-start transition-[box-shadow,background-color] duration-150 ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                  on
                    ? "bg-accent/6 shadow-[0_0_0_1.5px_var(--accent)]"
                    : "smooth-shadow-ring-xs [@media(hover:hover)]:hover:bg-surface-2/60",
                )}
              >
                <input
                  type="radio"
                  name="plan"
                  value={p}
                  checked={on}
                  onChange={() => setPlan(p)}
                  aria-label={`${PLAN_NAMES[p]}, ${PLAN_PRICES[p]} a month`}
                  // Invisible, over the whole card: the card is what you press.
                  className="absolute inset-0 cursor-pointer appearance-none rounded-xl opacity-0"
                />
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-3.5 right-3.5 grid size-5 place-items-center rounded-full transition-[opacity,scale] duration-150 ease-out",
                    on ? "scale-100 bg-accent text-bg opacity-100" : "scale-75 opacity-0",
                  )}
                >
                  <Check size={13} stroke={2.5} />
                </span>
                <span className="text-sm font-medium text-muted">{PLAN_NAMES[p]}</span>
                <span className="tnum -mt-1.5 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tracking-tight">{PLAN_PRICES[p]}</span>
                  <span className="text-xs text-muted">a month</span>
                </span>
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {planFacts(p, reason).map((fact, i) => (
                    <li key={fact} className="flex gap-2">
                      <Check
                        aria-hidden
                        size={14}
                        stroke={2.25}
                        className={cn("mt-0.5 shrink-0", i === 0 ? "text-accent" : "text-muted")}
                      />
                      <span className={i === 0 ? "text-text" : "text-muted"}>{fact}</span>
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </fieldset>
        <div className="flex items-center gap-3 max-sm:flex-col-reverse max-sm:items-stretch">
          <HrefLink
            href="/billing"
            className="mr-auto text-sm text-muted underline decoration-from-font underline-offset-2 max-sm:mx-auto max-sm:py-2 [@media(hover:hover)]:hover:text-text"
          >
            Compare plans
          </HrefLink>
          <Button ref={cta} variant="primary" onClick={() => void go()} disabled={leaving}>
            <BusyContent busy={leaving}>Continue with {PLAN_NAMES[plan]}</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
