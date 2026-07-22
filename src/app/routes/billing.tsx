import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLinks, useMembers, useDomains, useCheckout, usePortal } from "../lib/hooks";
import { shortDate } from "../lib/dates";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, PLAN_PRICES, type OrgPlan } from "@/shared/types";
import { Button } from "../ui/button";
import { Badge, Card, PageHeader, Table, Th, Td } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { Skeleton } from "../ui/skeleton";
import { useShake } from "../lib/auth-form";
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
    <div className="my-3 text-xs tnum">
      <Table>
        <thead>
          <tr>
            <Th />
            <Th>Free</Th>
            <Th className="text-accent">Hobby</Th>
            <Th className="text-accent">Pro</Th>
          </tr>
        </thead>
        <tbody>
          {PLAN_FEATURES.map(([label, free, hobby, pro]) => (
            <tr key={label}>
              <Td className="text-muted">{label}</Td>
              <Td>{free}</Td>
              <Td className="text-accent">{hobby}</Td>
              <Td className="text-accent">{pro}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function PlanActions({
  plan,
  checkoutPlan,
  showPortalOverlay,
  confirmTimedOut,
  cancelAtPeriodEnd,
  periodEnd,
  shakeHobby,
  shakePro,
  shakePortal,
  onUpgrade,
  onPortal,
}: {
  plan: OrgPlan;
  checkoutPlan: "hobby" | "pro" | null;
  showPortalOverlay: boolean;
  confirmTimedOut: boolean;
  cancelAtPeriodEnd: boolean;
  periodEnd: number | null;
  shakeHobby: ReturnType<typeof useShake>;
  shakePro: ReturnType<typeof useShake>;
  shakePortal: ReturnType<typeof useShake>;
  onUpgrade: (target: "hobby" | "pro") => void;
  onPortal: () => void;
}) {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-2xs tracking-wider text-muted uppercase">Plan</p>
          <Badge color={plan === "free" ? "muted" : "mint"}>{PLAN_LABEL[plan]}</Badge>
        </div>
        <p className="text-sm text-muted">
          Billing is per account: your plan applies to every organization you own.
        </p>
        {cancelAtPeriodEnd && periodEnd && (
          <p className="text-sm text-amber-400">
            Your {PLAN_LABEL[plan]} plan is scheduled to cancel on{" "}
            {shortDate(periodEnd)}
            . Paid features remain available until then.
          </p>
        )}
        {confirmTimedOut && plan === "free" && (
          <p className="text-sm text-muted">
            Still confirming your payment. Your plan should activate shortly: refresh in a moment.
          </p>
        )}
        {plan === "free" && <PlanFeatureComparison />}
        <div>
          {plan === "free" ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="primary"
                disabled={checkoutPlan !== null}
                className={shakeHobby.className}
                onAnimationEnd={shakeHobby.end}
                onClick={() => onUpgrade("hobby")}
              >
                <BusyContent busy={checkoutPlan === "hobby"}>
                  Upgrade to Hobby · {PLAN_PRICES.hobby}/mo
                </BusyContent>
              </Button>
              <Button
                variant="primary"
                disabled={checkoutPlan !== null}
                className={shakePro.className}
                onAnimationEnd={shakePro.end}
                onClick={() => onUpgrade("pro")}
              >
                <BusyContent busy={checkoutPlan === "pro"}>
                  Upgrade to Pro · {PLAN_PRICES.pro}/mo
                </BusyContent>
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              disabled={showPortalOverlay}
              className={shakePortal.className}
              onAnimationEnd={shakePortal.end}
              onClick={onPortal}
            >
              <BusyContent busy={showPortalOverlay}>Manage subscription</BusyContent>
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
  );
}

function UsageMeter({
  plan,
  org,
  linkData,
  memberData,
  domainData,
  ownedOrgs,
  linksPending,
  membersPending,
  domainsPending,
}: {
  plan: OrgPlan;
  org: { id: string; name: string; plan: OrgPlan } | null;
  linkData: unknown[];
  memberData: unknown[];
  domainData: unknown[];
  ownedOrgs: number;
  linksPending: boolean;
  membersPending: boolean;
  domainsPending: boolean;
}) {
  if (!org) return null;
  const loading = linksPending || membersPending || domainsPending;
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-1">
        <p className="mb-2 text-2xs tracking-wider text-muted uppercase">Usage: {org.name}</p>
        {loading ? (
          <div className="flex flex-col gap-3 py-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted tnum">
              Links {linkData?.length ?? 0} / {PLAN_LIMITS[org.plan].links}
            </p>
            <p className="text-sm text-muted tnum">
              Members {memberData?.length ?? 0} / {PLAN_LIMITS[org.plan].members}
            </p>
            <p className="text-sm text-muted tnum">
              Domains {domainData?.length ?? 0} / {PLAN_LIMITS[org.plan].domains}
            </p>
          </>
        )}
        <p className="text-sm text-muted tnum">
          Orgs you own {ownedOrgs} / {PLAN_LIMITS[plan].orgs}
        </p>
      </div>
    </Card>
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

function useCheckoutFlow() {
  const me = useCurrentUser();
  const checkout = useCheckout();
  const portal = usePortal();
  const toast = useToast();
  const shakeHobby = useShake();
  const shakePro = useShake();
  const shakePortal = useShake();
  const qc = useQueryClient();

  const [checkoutPlan, setCheckoutPlan] = useState<"hobby" | "pro" | null>(null);
  const [showPortalOverlay, setShowPortalOverlay] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  const celebrat = useCallback(() => {
    setShowCelebration(true);
    const colors = ["#cdb9f5", "#b9e6c9", "#f5b8c8", "#f2e3b3", "#b9d9f0"];
    confetti({
      particleCount: 40, angle: 60, spread: 70, startVelocity: 50,
      origin: { x: 0, y: 0.75 }, colors,
    });
    confetti({
      particleCount: 40, angle: 120, spread: 70, startVelocity: 50,
      origin: { x: 1, y: 0.75 }, colors,
    });
    setTimeout(() => setShowCelebration(false), 4000);
  }, []);

  const handleUpgrade = async (target: "hobby" | "pro") => {
    setCheckoutPlan(target);
    try {
      const data = await checkout.mutateAsync(target);
      setTimeout(() => window.location.assign(data.url), 300);
    } catch (e) {
      setCheckoutPlan(null);
      (target === "hobby" ? shakeHobby : shakePro).start();
      toast((e as Error).message, "error");
    }
  };

  const handlePortal = async () => {
    setShowPortalOverlay(true);
    try {
      const data = await portal.mutateAsync();
      setTimeout(() => window.location.assign(data.url), 800);
    } catch (e) {
      setShowPortalOverlay(false);
      shakePortal.start();
      toast((e as Error).message, "error");
    }
  };

  // Reset overlay state when returning from Polar via bfcache (browser back).
  useEffect(() => {
    const handler = () => {
      setCheckoutPlan(null);
      setShowPortalOverlay(false);
      setConfirming(false);
      setConfirmTimedOut(false);
      setShowCelebration(false);
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, []);

  const plan = me.data?.user.plan ?? "free";

  // Detect the checkout return once on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("checkout_id")) {
      setCheckoutPlan(null);
      setShowPortalOverlay(false);
      setConfirming(true);
      url.searchParams.delete("checkout_id");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // While confirming, poll /user until plan flips to paid.
  const celebratRef = useRef(celebrat);
  useEffect(() => { celebratRef.current = celebrat; }, [celebrat]);
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

  // Auto-upgrade from ?plan= param
  const planParamDone = useRef(false);
  const upgradeRef = useRef(handleUpgrade);
  useEffect(() => { upgradeRef.current = handleUpgrade; });
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

  return {
    plan, checkoutPlan, showPortalOverlay, showCelebration, confirming, confirmTimedOut,
    setShowCelebration, handleUpgrade, handlePortal, shakeHobby, shakePro, shakePortal,
  };
}

export function BillingPage() {
  const me = useCurrentUser();
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const { data: linkData, isPending: linksPending } = useLinks(orgId);
  const { data: memberData, isPending: membersPending } = useMembers(orgId);
  const { data: domainData, isPending: domainsPending } = useDomains(orgId);
  const ownedOrgs = me.data?.orgs.filter((o) => o.role === "owner").length ?? 0;

  const {
    plan, checkoutPlan, showPortalOverlay, showCelebration, confirming, confirmTimedOut,
    setShowCelebration, handleUpgrade, handlePortal, shakeHobby, shakePro, shakePortal,
  } = useCheckoutFlow();

  const cancelAtPeriodEnd =
    me.data?.user.polarSubscriptionCancelAtPeriodEnd ?? false;
  const periodEnd = me.data?.user.polarSubscriptionCurrentPeriodEnd ?? null;

  return (
    <div>
      <PageHeader title="Billing" sub="Your subscription" />
      <div className="flex flex-col gap-4">
        <PlanActions
          plan={plan}
          checkoutPlan={checkoutPlan}
          showPortalOverlay={showPortalOverlay}
          confirmTimedOut={confirmTimedOut}
          cancelAtPeriodEnd={cancelAtPeriodEnd}
          periodEnd={periodEnd}
          shakeHobby={shakeHobby}
          shakePro={shakePro}
          shakePortal={shakePortal}
          onUpgrade={handleUpgrade}
          onPortal={handlePortal}
        />
        <UsageMeter
          plan={plan}
          org={org}
          linkData={linkData ?? []}
          memberData={memberData ?? []}
          domainData={domainData ?? []}
          ownedOrgs={ownedOrgs}
          linksPending={linksPending}
          membersPending={membersPending}
          domainsPending={domainsPending}
        />
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
