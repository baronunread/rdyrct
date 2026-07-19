import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe, useLinks, useMembers, useCheckout, usePortal } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Badge, Card, PageHeader } from "../ui/misc";
import { useToast } from "../ui/toast";

export function BillingPage() {
  const me = useMe();
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const links = useLinks(orgId);
  const members = useMembers(orgId);
  const checkout = useCheckout();
  const portal = usePortal();
  const toast = useToast();
  const qc = useQueryClient();

  const plan = me.data?.user.plan ?? "free";
  const cancelAtPeriodEnd =
    me.data?.user.polarSubscriptionCancelAtPeriodEnd ?? false;
  const periodEnd = me.data?.user.polarSubscriptionCurrentPeriodEnd ?? null;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgraded") === "1") {
      toast("Welcome to Pro!");
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
                  disabled={checkout.isPending}
                  onClick={() =>
                    checkout.mutate(undefined, {
                      onError: (e) => toast(e.message, "error"),
                    })
                  }
                >
                  {checkout.isPending ? "…" : "Upgrade to Pro"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={portal.isPending}
                  onClick={() =>
                    portal.mutate(undefined, {
                      onError: (e) => toast(e.message, "error"),
                    })
                  }
                >
                  {portal.isPending ? "…" : "Manage subscription"}
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
    </div>
  );
}
