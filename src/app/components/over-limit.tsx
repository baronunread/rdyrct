/**
 * One way of saying "this is over your plan", used everywhere it is true
 * (#163).
 *
 * The product used to say nothing. The links page showed a bare `500 / 30
 * links` with no explanation and no way out, error copy assumed you were *at*
 * the cap rather than 500 past it, and a downgraded org's members, domains
 * and analytics gave no signal at all. Three surfaces inventing three
 * explanations is how a person ends up believing their data was deleted.
 *
 * So there are two components and one sentence-builder here, and every
 * locked or over-limit screen uses them:
 *
 * - `OverLimitBanner`: one per org, at the top of the app, listing what is
 *   over and what to do.
 * - `LockedPanel`: what a frozen thing shows in place of its controls, with
 *   the countdown when there is one.
 */
import type { ReactNode } from "react";
import { Lock } from "@/app/ui/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HrefLink } from "../lib/router-search";
import { errorMessage } from "@/app/lib/error-message";
import { api } from "../lib/api";
import { Button } from "../ui/button";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { buttonClass } from "../ui/button-class";
import { useCurrentOrg } from "../lib/current-org";
import { graceLabel, graceRunning } from "../lib/grace";
import {
  OVER_LIMIT_KEYS,
  PLAN_LIMITS,
  isOverLimit,
  type OverLimits,
  type OrgPlan,
  type UserOrg,
} from "@/shared/types";

/**
 * How each resource reads when an org holds more of it than the plan allows.
 *
 * Both halves of each phrase are here on purpose: "500 links, and this plan
 * allows 30" reads correctly whether you are one over or four hundred and
 * seventy over, which the old "upgrade for more" copy did not.
 */
const OVER_COPY = {
  links: (count: number, limit: number) => `${count} links, and this plan allows ${limit}`,
  members: (count: number, limit: number) => `${count} members, and this plan allows ${limit}`,
  domains: (count: number, limit: number) =>
    limit === 0
      ? `${count} custom ${count === 1 ? "domain" : "domains"}, and this plan has none`
      : `${count} custom domains, and this plan allows ${limit}`,
} satisfies Record<(typeof OVER_LIMIT_KEYS)[number], (count: number, limit: number) => string>;

function overPhrases(over: OverLimits, plan: OrgPlan): string[] {
  const limits = PLAN_LIMITS[plan];
  return OVER_LIMIT_KEYS.flatMap((key) => {
    const count = over[key];
    return count === undefined ? [] : [OVER_COPY[key](count, limits[key])];
  });
}

function BillingLink({ label = "See plans" }: { label?: string }) {
  return (
    <HrefLink href="/billing" className={buttonClass({ variant: "outline", size: "sm" })}>
      {label}
    </HrefLink>
  );
}

/**
 * The org-wide banner. Renders only when there is something to say, so every
 * page can mount it unconditionally.
 *
 * Nothing here is a warning colour. The state is "you have more than you pay
 * for", not "something broke", and painting it red would make an ordinary
 * billing fact look like an outage.
 */
export function OverLimitBanner() {
  const { org } = useCurrentOrg();
  if (!org) return null;
  if (org.locked) return <LockedOrgNotice org={org} />;
  if (!isOverLimit(org.over)) return null;
  return (
    <Notice>
      <p className="text-sm">
        <strong className="font-semibold">{org.name}</strong> has {joinPhrases(org.over, org.plan)}.
        Nothing was deleted. {overLimitAdvice(org)}
      </p>
      <BillingLink />
    </Notice>
  );
}

/**
 * A locked org, with the two ways out (#160): upgrade, or keep this one
 * active instead of whichever org currently is.
 *
 * The second is a real choice, not a nag. Reconciliation defaults to the
 * oldest org so an owner who ignores this still has a working account; this
 * is how they say they meant a different one. It is reversible: the same
 * button on the other org swaps them back.
 */
function LockedOrgNotice({ org }: { org: UserOrg }) {
  const qc = useQueryClient();
  const toast = useToast();
  const keepActive = useMutation({
    mutationFn: () => api(`/orgs/${org.id}/keep-active`, { method: "POST" }),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["user"] });
      toast(`${org.name} is active again`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const onlyOne = PLAN_LIMITS[org.plan].orgs === 1;
  return (
    <Notice>
      <p className="max-w-prose text-sm">
        <strong className="font-semibold">{org.name}</strong> is locked, because your plan covers{" "}
        {onlyOne ? "one organization" : `${PLAN_LIMITS[org.plan].orgs} organizations`} and you own
        more. Nothing was deleted and its links keep working.
        {org.role === "owner"
          ? " Upgrade to unlock every organization, or use this one instead of the one that is active now."
          : " Its owner can upgrade, or make this the organization they keep active."}
      </p>
      <div className="flex items-center gap-2">
        {/* The route is owner-only, so anybody else gets a button whose one
            outcome is a 403 toast. Everyone still sees the explanation. */}
        {org.role === "owner" && (
          <Button
            variant="outline"
            size="sm"
            disabled={keepActive.isPending}
            onClick={() => keepActive.mutate()}
          >
            <BusyContent busy={keepActive.isPending}>Use this one</BusyContent>
          </Button>
        )}
        <BillingLink label="Upgrade to Pro" />
      </div>
    </Notice>
  );
}

/**
 * What to do about it, which differs by what is over.
 *
 * Over-cap links and members are not read-only: every link stays editable and
 * deletable, and only *new* ones are blocked. Only the domains have a
 * deadline, and only while it is still ahead.
 */
function overLimitAdvice(org: UserOrg): string {
  if (org.over.domains !== undefined)
    return graceRunning(org.graceEndsAt)
      ? `Your custom domains keep redirecting until ${new Date(org.graceEndsAt!).toLocaleDateString()} (${graceLabel(org.graceEndsAt!)}), then they stop.`
      : "Your custom domains have stopped redirecting. Upgrading brings them straight back.";
  return "Everything you have keeps working. You can delete what you no longer need, or upgrade to keep it all.";
}

function joinPhrases(over: OverLimits, plan: OrgPlan): string {
  const phrases = overPhrases(over, plan);
  if (phrases.length <= 1) return phrases[0] ?? "";
  return `${phrases.slice(0, -1).join("; ")}; and ${phrases[phrases.length - 1]}`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
      {children}
    </div>
  );
}

/**
 * What a locked thing shows instead of its controls: what it is, why it is
 * locked, when it stops working if there is a deadline, and one way back.
 *
 * `until` is the end of the grace period, for the things that keep working
 * through it (custom domains). Anything frozen at once leaves it out rather
 * than showing a countdown to nothing.
 */
export function LockedPanel({
  title,
  reason,
  until,
  cta = "See plans",
}: {
  title: string;
  reason: string;
  until?: number | null;
  cta?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 px-4 py-4">
      <div className="flex items-center gap-2">
        <Lock size={15} className="text-muted" aria-hidden />
        <h2 className="font-semibold">{title}</h2>
      </div>
      <p className="max-w-prose text-sm text-muted">{reason}</p>
      {until != null && (
        <p className="tnum max-w-prose text-sm text-muted">
          {graceRunning(until)
            ? `It keeps working until ${new Date(until).toLocaleDateString()} (${graceLabel(until)}), then it stops.`
            : "It has stopped working."}{" "}
          Nothing is deleted, and upgrading brings it back with no setup to redo.
        </p>
      )}
      <div>
        <BillingLink label={cta} />
      </div>
    </div>
  );
}
