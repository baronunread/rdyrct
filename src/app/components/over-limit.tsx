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
 * - `ClickCapBanner`: the month's tracked clicks at 80% and at 100% of the
 *   plan's cap (#387), on the dashboard and analytics.
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
import { cn } from "../ui/cn";
import { useCurrentOrg } from "../lib/current-org";
import { useClickUsage, useDomains } from "../lib/hooks";
import { clickCapNotice } from "@/shared/click-usage";
import { SUPPORT_EMAIL } from "@/shared/support";
import { graceRunning } from "../lib/grace";
import {
  OVER_LIMIT_KEYS,
  PLAN_LIMITS,
  isOverLimit,
  type OrgPlan,
  type UserOrg,
} from "@/shared/types";

function BillingLink({ label = "See plans", primary }: { label?: string; primary?: boolean }) {
  return (
    <HrefLink
      href="/billing"
      className={buttonClass({ variant: primary ? "primary" : "outline", size: "sm" })}
    >
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
  const clicks = useClickCapNotice();
  if (!org) return null;
  if (org.locked) return <LockedOrgNotice org={org} />;
  if (!isOverLimit(org.over)) return null;
  if (domainsStopped(org)) return <DomainStoppedNotice org={org} />;
  const facts = overFacts(org);
  // The month's clicks join the same line rather than a second banner.
  if (clicks?.reached) facts.push({ label: "Clicks counted", value: clicks.figure, over: true });
  return (
    <Notice
      title={`Over the ${PLAN_NAMES[org.plan]} plan`}
      facts={facts}
      action={<BillingLink primary />}
      note={overLimitAdvice(org)}
    />
  );
}

/** The grace period ran out and the custom domains stopped answering. That
 * is no longer "more than you pay for": links are broken, so it says so in
 * the danger colour and leads with the fix. */
function domainsStopped(org: UserOrg): boolean {
  return org.over.domains !== undefined && !!org.graceEndsAt && !graceRunning(org.graceEndsAt);
}

function DomainStoppedNotice({ org }: { org: UserOrg }) {
  const domains = useDomains(org.id);
  const stopped = (domains.data ?? []).filter((d) => d.lockedAt !== null);
  const one = stopped.length === 1;
  const facts: Fact[] = [];
  if (stopped.length > 0)
    facts.push({
      label: one ? "Domain" : "Domains",
      value: one ? stopped[0].hostname : String(stopped.length),
      mono: one,
    });
  if (org.graceEndsAt) facts.push({ label: "Since", value: monthDay(org.graceEndsAt) });
  facts.push({ label: "Its links", value: "answer “not found”", over: true });
  // Links or members over the cap too: same line, never a second banner.
  for (const fact of overFacts(org)) if (fact.over) facts.push(fact);
  return (
    <Notice
      tone="bad"
      title={one || stopped.length === 0 ? "A domain stopped working" : "Domains stopped working"}
      facts={facts}
      action={<BillingLink label="Upgrade to bring it back" primary />}
    />
  );
}

const PLAN_NAMES = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "Unlimited",
} satisfies Record<OrgPlan, string>;

/** "Links 184 of 30", one per resource over its cap, then the domains'
 * deadline when there is one. */
function overFacts(org: UserOrg): Fact[] {
  const limits = PLAN_LIMITS[org.plan];
  // Domains are left out of the counts: "Custom domains 1 of 0" reads as
  // a glitch. What matters about them is the day they stop.
  const facts: Fact[] = OVER_LIMIT_KEYS.flatMap((key) => {
    const count = org.over[key];
    if (count === undefined || key === "domains") return [];
    return [{ label: FACT_LABELS[key], value: `${count} of ${limits[key]}`, over: true }];
  });
  const domains = org.over.domains;
  if (domains !== undefined && org.graceEndsAt) {
    const one = domains - limits.domains <= 1;
    const day = monthDay(org.graceEndsAt);
    facts.push({
      label: one ? "Domain" : "Domains",
      value: graceRunning(org.graceEndsAt) ? `${one ? "stops" : "stop"} ${day}` : "stopped",
    });
  }
  return facts;
}

const FACT_LABELS = {
  links: "Links",
  members: "Members",
  domains: "Custom domains",
} satisfies Record<(typeof OVER_LIMIT_KEYS)[number], string>;

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
    <Notice
      tone="bad"
      title="Read-only"
      facts={[
        {
          label: "Why",
          value: `your plan covers ${onlyOne ? "one organization" : `${PLAN_LIMITS[org.plan].orgs} organizations`}`,
        },
        { label: "Links", value: "keep working" },
      ]}
      note={
        org.role === "owner"
          ? "Nothing was deleted. Upgrade to unlock every organization, or use this one instead of the one that is active now."
          : "Nothing was deleted. Its owner can upgrade, or make this the organization they keep active."
      }
      action={
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
              <BusyContent busy={keepActive.isPending}>Use this one instead</BusyContent>
            </Button>
          )}
          <BillingLink label="Upgrade to Pro" primary />
        </div>
      }
    />
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
  const blocked = [
    org.over.links !== undefined && "links",
    org.over.members !== undefined && "members",
  ].filter(Boolean);
  // The domain's deadline is already a fact on the line above; saying it
  // again here only made the note three lines long.
  const parts = ["Nothing was deleted and every link still works."];
  if (blocked.length > 0)
    parts.push(`You can't add ${blocked.join(" or ")} until you upgrade or make room.`);
  return parts.join(" ");
}

/** "Nov 6": a deadline this close needs no year. */
function monthDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Tracked clicks this month, once they pass 80% of the plan's cap (#387).
 *
 * Not a warning colour either: nothing broke. The first thing it says past
 * the cap is that the links still work, because that is the first thing
 * somebody reading "limit reached" worries about.
 */
export function ClickCapBanner() {
  const { org } = useCurrentOrg();
  const notice = useClickCapNotice();
  if (!notice) return null;
  // Over the plan or locked, the banner above the page already says it.
  if (org && (org.locked || (isOverLimit(org.over) && notice.reached))) return null;
  return (
    <Notice
      title={notice.reached ? "Click limit reached" : "Near the click limit"}
      facts={[{ label: "Clicks counted", value: notice.figure, over: notice.reached }]}
      action={notice.offerUpgrade ? <BillingLink /> : undefined}
      note={<WithSupportLink text={notice.text} />}
    />
  );
}

/** `text` with the support address, where it appears, as a mail link. The
 * words stay in click-usage.ts, shared with the email. */
function WithSupportLink({ text }: { text: string }) {
  const [before, after] = text.split(SUPPORT_EMAIL);
  if (after === undefined) return text;
  return (
    <>
      {before}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="font-mono text-accent hover:underline">
        {SUPPORT_EMAIL}
      </a>
      {after}
    </>
  );
}

/** What the cap banner says for the current org, or null. */
function useClickCapNotice() {
  const { org } = useCurrentOrg();
  const usage = useClickUsage(org?.id ?? "");
  const notice = clickCapNotice(org, usage.data, Date.now());
  if (!notice || !usage.data) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  return {
    ...notice,
    reached: usage.data.clicks >= usage.data.limit,
    figure: `${n(usage.data.clicks)} of ${n(usage.data.limit)}`,
  };
}

interface Fact {
  label: string;
  value: string;
  /** Past the cap: set in the danger colour. */
  over?: boolean;
  /** An identifier (a hostname): set in mono. */
  mono?: boolean;
}

/**
 * The one notice (rdyrct-design, "Over the plan is one notice"): a state, a
 * line of facts, one action, and a plain sentence under it. Butter for "more
 * than you pay for", danger only for an org that is read-only.
 */
function Notice({
  title,
  facts,
  action,
  note,
  tone = "warn",
}: {
  title: string;
  facts: Fact[];
  action?: ReactNode;
  note?: ReactNode;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl py-2 pr-2 pl-4",
          tone === "bad"
            ? "bg-[color-mix(in_oklab,var(--danger)_6%,var(--surface))] shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]"
            : "bg-[color-mix(in_oklab,var(--butter)_8%,var(--surface))] shadow-[0_0_0_1px_color-mix(in_oklab,var(--butter)_40%,transparent)]",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap",
            tone === "bad" ? "text-danger" : "text-butter",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {title}
        </span>
        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <dt className="text-muted">{f.label}</dt>
              <dd
                className={cn(
                  "tnum font-semibold",
                  f.over && "text-danger",
                  f.mono && "font-mono text-[0.8125rem] font-normal",
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {note && <p className="max-w-prose px-1 text-xs text-pretty text-muted">{note}</p>}
    </div>
  );
}

/**
 * The one way to say "this needs a paid plan" or "this is locked": a row
 * with what it is, why, and one way back. Every paid feature a plan lacks
 * shows this, not its own upsell. A deadline belongs to the org banner
 * above, not here a second time. `bare` drops the card, for a panel
 * that sits as a row inside a `SettingsGroup`. `primary` is for a screen
 * where upgrading is the only thing to do.
 */
export function LockedPanel({
  title,
  reason,
  cta = "See plans",
  primary,
  bare,
}: {
  title: string;
  reason: string;
  cta?: string;
  primary?: boolean;
  bare?: boolean;
}) {
  const Heading = bare ? "h3" : "h2";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5",
        !bare && "rounded-xl bg-surface smooth-shadow-ring-xs",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-72 gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          <Lock size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <Heading className="text-sm font-semibold">{title}</Heading>
          <p className="mt-0.5 max-w-prose text-sm text-pretty text-muted">{reason}</p>
        </div>
      </div>
      <div className="max-sm:ps-11">
        <BillingLink label={cta} primary={primary} />
      </div>
    </div>
  );
}
