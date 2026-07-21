import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLinks, useMembers, useDomains, useCheckout, usePortal } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, PLAN_PRICES, type OrgPlan } from "@/shared/types";
import { Button } from "../ui/button";
import { Badge, Card, PageHeader } from "../ui/misc";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";

const PLAN_LABEL: Record<OrgPlan, string> = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
};

const PLAN_FEATURES = [
  ["Links", `${PLAN_LIMITS.free.links}`, `${PLAN_LIMITS.hobby.links}`, `${PLAN_LIMITS.pro.links}`],
  ["Members", `${PLAN_LIMITS.free.members}`, `${PLAN_LIMITS.hobby.members}`, `${PLAN_LIMITS.pro.members}`],
  ["Domains", `${PLAN_LIMITS.free.domains}`, `${PLAN_LIMITS.hobby.domains}`, `${PLAN_LIMITS.pro.domains}`],
  ["Org. you own", `${PLAN_LIMITS.free.orgs}`, `${PLAN_LIMITS.hobby.orgs}`, `${PLAN_LIMITS.pro.orgs}`],
  ["QR codes", "No", "Yes", "Yes"],
  ["Analytics", `${PLAN_LIMITS.free.analyticsDays}d`, `${PLAN_LIMITS.hobby.analyticsDays}d`, `${PLAN_LIMITS.pro.analyticsDays}d`],
] as const;

function PlanFeatureComparison() {
  return (
    <div className="my-3 overflow-x-auto">
      <table className="w-full text-xs tnum">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 pr-4 font-medium" />
            <th className="pb-1 pr-4 font-medium text-muted">Free</th>
            <th className="pb-1 pr-4 font-medium text-accent">Hobby</th>
            <th className="pb-1 font-medium text-accent">Pro</th>
          </tr>
        </thead>
        <tbody className="text-text">
          {PLAN_FEATURES.map(([label, free, hobby, pro]) => (
            <tr key={label} className="border-t border-border/50">
              <td className="py-1.5 pr-4 text-muted">{label}</td>
              <td className="py-1.5 pr-4">{free}</td>
              <td className="py-1.5 pr-4 text-accent">{hobby}</td>
              <td className="py-1.5 text-accent">{pro}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingOverlay({
  show,
  message,
}: {
  show: boolean;
  message: string;
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <m.div
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />
      <m.div
        className="relative z-10 flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-2xl"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
        <p className="font-bold">{message}</p>
      </m.div>
    </div>
  );
}

function CelebrationOverlay({
  show,
  plan,
  onDismiss,
}: {
  show: boolean;
  plan: OrgPlan;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          role="button"
          tabIndex={0}
          aria-label="Dismiss celebration"
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center"
          onClick={onDismiss}
          onKeyDown={(e) =>
            (e.key === "Enter" || e.key === " ") && onDismiss()
          }
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px]" />
          <m.div
            className="relative z-10 flex flex-col items-center gap-4 rounded-xl border border-accent/30 bg-surface p-10 text-center shadow-2xl"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <span className="text-5xl">🎉</span>
            <p className="text-xl font-bold text-accent">
              Welcome to {PLAN_LABEL[plan]}!
            </p>
            <p className="text-sm text-muted">
              You now have access to all {PLAN_LABEL[plan]} features.
            </p>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function BillingPage() {
  // Which paid plan a checkout is in flight for (null = none).
  const [checkoutPlan, setCheckoutPlan] = useState<"hobby" | "pro" | null>(
    null,
  );
  const [showPortalOverlay, setShowPortalOverlay] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  // Returning from Polar with ?checkout_id=: poll /user until the webhook
  // flips the plan, then celebrate. A forged id just times out.
  const [confirming, setConfirming] = useState(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);
  const me = useCurrentUser();
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const links = useLinks(orgId);
  const members = useMembers(orgId);
  const domains = useDomains(orgId);
  const ownedOrgs = me.data?.orgs.filter((o) => o.role === "owner").length ?? 0;
  const checkout = useCheckout();
  const portal = usePortal();
  const toast = useToast();
  const qc = useQueryClient();
  const celebratRef = useRef<(() => void) | null>(null);

  const celebrat = useCallback(() => {
    setShowCelebration(true);
    const colors = ["#cdb9f5", "#b9e6c9", "#f5b8c8", "#f2e3b3", "#b9d9f0"];
    confetti({
      particleCount: 40,
      angle: 60,
      spread: 70,
      startVelocity: 50,
      origin: { x: 0, y: 0.75 },
      colors,
    });
    confetti({
      particleCount: 40,
      angle: 120,
      spread: 70,
      startVelocity: 50,
      origin: { x: 1, y: 0.75 },
      colors,
    });
    setTimeout(() => setShowCelebration(false), 4000);
  }, []);

  useEffect(() => {
    celebratRef.current = celebrat;
  }, [celebrat]);

  const plan = me.data?.user.plan ?? "free";
  const cancelAtPeriodEnd =
    me.data?.user.polarSubscriptionCancelAtPeriodEnd ?? false;
  const periodEnd = me.data?.user.polarSubscriptionCurrentPeriodEnd ?? null;

  const handleUpgrade = async (target: "hobby" | "pro") => {
    setCheckoutPlan(target);
    try {
      const data = await checkout.mutateAsync(target);
      setTimeout(() => window.location.assign(data.url), 300);
    } catch (e) {
      setCheckoutPlan(null);
      toast((e as Error).message, "error");
    }
  };
  const upgradeRef = useRef(handleUpgrade);
  useEffect(() => {
    upgradeRef.current = handleUpgrade;
  });

  // The landing page's "Start Hobby/Pro" CTAs arrive as /billing?plan=…: once
  // the user is loaded, kick off that checkout (free plan only, once) and
  // strip the param so back/refresh doesn't re-trigger it.
  const planParamDone = useRef(false);
  useEffect(() => {
    if (!me.data || planParamDone.current) return;
    planParamDone.current = true;
    const url = new URL(window.location.href);
    const target = url.searchParams.get("plan");
    if (target !== "hobby" && target !== "pro") return;
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());
    if (me.data.user.plan === "free") void upgradeRef.current(target);
  }, [me.data]);

  // Detect the checkout return once on mount; the id is single-use, so strip
  // it from the URL right away.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("checkout_id")) {
      setConfirming(true);
      url.searchParams.delete("checkout_id");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // While confirming, poll /user until the Polar webhook flips the plan to a
  // paid one — the entitlement the app actually gates on. Cap the wait at ~20s.
  useEffect(() => {
    if (!confirming) return;
    if (plan !== "free") {
      setConfirming(false);
      celebratRef.current?.();
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (tries > 10) {
        window.clearInterval(id);
        setConfirming(false);
        setConfirmTimedOut(true);
        return;
      }
      void qc.refetchQueries({ queryKey: ["user"] });
    }, 2000);
    return () => window.clearInterval(id);
  }, [confirming, plan, qc]);

  return (
    <div>
      <PageHeader title="Billing" sub="Your subscription" />
      <div className="flex flex-col gap-4">
        <Card className="max-w-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-2xs tracking-wider text-muted uppercase">
                Plan
              </p>
              <Badge color={plan === "free" ? "muted" : "mint"}>
                {PLAN_LABEL[plan]}
              </Badge>
            </div>
            <p className="text-sm text-muted">
              Billing is per account: your plan applies to every organization
              you own.
            </p>
            {cancelAtPeriodEnd && periodEnd && (
              <p className="text-sm text-amber-400">
                Your {PLAN_LABEL[plan]} plan is scheduled to cancel on{" "}
                {new Date(periodEnd).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                . Paid features remain available until then.
              </p>
            )}
            {confirmTimedOut && plan === "free" && (
              <p className="text-sm text-muted">
                Still confirming your payment. Your plan should activate
                shortly: refresh in a moment.
              </p>
            )}
            {plan === "free" && <PlanFeatureComparison />}
            <div>
              {plan === "free" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={checkoutPlan !== null}
                    onClick={() => handleUpgrade("hobby")}
                  >
                    {checkoutPlan === "hobby" ? (
                      <Spinner />
                    ) : (
                      `Upgrade to Hobby · ${PLAN_PRICES.hobby}/mo`
                    )}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={checkoutPlan !== null}
                    onClick={() => handleUpgrade("pro")}
                  >
                    {checkoutPlan === "pro" ? (
                      <Spinner />
                    ) : (
                      `Upgrade to Pro · ${PLAN_PRICES.pro}/mo`
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  disabled={showPortalOverlay}
                  onClick={async () => {
                    setShowPortalOverlay(true);
                    try {
                      const data = await portal.mutateAsync();
                      setTimeout(
                        () => window.location.assign(data.url),
                        800,
                      );
                    } catch (e) {
                      setShowPortalOverlay(false);
                      toast((e as Error).message, "error");
                    }
                  }}
                >
                  {showPortalOverlay ? (
                    <Spinner />
                  ) : (
                    "Manage subscription"
                  )}
                </Button>
              )}
              {plan === "hobby" && (
                <p className="mt-2 text-xs text-muted">
                  Want Pro? Switch plans from the subscription portal.
                </p>
              )}
            </div>
          </div>
        </Card>

        {org && (
          <Card className="max-w-2xl">
            <div className="flex flex-col gap-1">
              <p className="mb-2 text-2xs tracking-wider text-muted uppercase">
                Usage: {org.name}
              </p>
              <p className="text-sm text-muted tnum">
                Links {links.data?.length ?? 0} / {PLAN_LIMITS[org.plan].links}
              </p>
              <p className="text-sm text-muted tnum">
                Members {members.data?.length ?? 0} /{" "}
                {PLAN_LIMITS[org.plan].members}
              </p>
              <p className="text-sm text-muted tnum">
                Domains {domains.data?.length ?? 0} /{" "}
                {PLAN_LIMITS[org.plan].domains}
              </p>
              <p className="text-sm text-muted tnum">
                Orgs you own {ownedOrgs} / {PLAN_LIMITS[me.data!.user.plan].orgs}
              </p>
            </div>
          </Card>
        )}
      </div>

      <LazyMotion features={domAnimation}>
        <BillingOverlay
          show={checkoutPlan !== null || showPortalOverlay || confirming}
          message={confirming ? "Confirming your upgrade…" : "Redirecting to Polar…"}
        />
        <CelebrationOverlay
          show={showCelebration}
          plan={plan}
          onDismiss={() => setShowCelebration(false)}
        />
      </LazyMotion>
    </div>
  );
}
