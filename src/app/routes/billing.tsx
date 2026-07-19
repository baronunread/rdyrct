import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe, useLinks, useMembers, useCheckout, usePortal } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Badge, Card, PageHeader } from "../ui/misc";
import { useToast } from "../ui/toast";

export function BillingPage() {
  const [showCheckoutOverlay, setShowCheckoutOverlay] = useState(false);
  const [showPortalOverlay, setShowPortalOverlay] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const me = useMe();
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const links = useLinks(orgId);
  const members = useMembers(orgId);
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

  const handleUpgrade = async () => {
    setShowCheckoutOverlay(true);
    try {
      const data = await checkout.mutateAsync();
      setTimeout(() => window.location.assign(data.url), 300);
    } catch (e) {
      setShowCheckoutOverlay(false);
      toast((e as Error).message, "error");
    }
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgraded") === "1") {
      celebratRef.current?.();
      qc.invalidateQueries({ queryKey: ["user"] });
      url.searchParams.delete("upgraded");
      window.history.replaceState({}, "", url.toString());
    }
    // run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader title="Billing" sub="Your subscription" />
      <div className="flex flex-col gap-4">
        <Card className="max-w-lg">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] tracking-wider text-muted uppercase">
                Plan
              </p>
              <Badge color={plan === "pro" ? "mint" : "muted"}>
                {plan === "pro" ? "Pro" : "Free"}
              </Badge>
            </div>
            <p className="text-sm text-muted">
              Billing is per account: Pro applies to every organization you
              own.
            </p>
            {cancelAtPeriodEnd && periodEnd && (
              <p className="text-sm text-amber-400">
                Your Pro plan is scheduled to cancel on{" "}
                {new Date(periodEnd).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                . Pro features remain available until then.
              </p>
            )}
            <div>
              {plan === "free" ? (
                <Button
                  variant="primary"
                  disabled={showCheckoutOverlay}
                  onClick={handleUpgrade}
                >
                  {showCheckoutOverlay ? (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    "Upgrade to Pro"
                  )}
                </Button>
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
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    "Manage subscription"
                  )}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {org && (
          <Card className="max-w-lg">
            <div className="flex flex-col gap-1">
              <p className="mb-2 text-[11px] tracking-wider text-muted uppercase">
                Usage: {org.name}
              </p>
              <p className="text-sm text-muted tnum">
                Links {links.data?.length ?? 0} / {PLAN_LIMITS[org.plan].links}
              </p>
              <p className="text-sm text-muted tnum">
                Members {members.data?.length ?? 0} /{" "}
                {PLAN_LIMITS[org.plan].members}
              </p>
            </div>
          </Card>
        )}
      </div>

      {(showCheckoutOverlay || showPortalOverlay) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className="relative z-10 flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-8 text-center shadow-2xl"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
            <p className="font-bold">Redirecting to Polar…</p>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {showCelebration && (
          <motion.div
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center"
            onClick={() => setShowCelebration(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px]" />
            <motion.div
              className="relative z-10 flex flex-col items-center gap-4 rounded-xl border border-accent/30 bg-surface p-10 text-center shadow-2xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <span className="text-5xl">🎉</span>
              <p className="text-xl font-bold text-accent">Welcome to Pro!</p>
              <p className="text-sm text-muted">
                You now have access to all Pro features.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
