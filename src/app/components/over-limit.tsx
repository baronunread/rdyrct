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
import { OVER_LIMIT_KEYS, isOverLimit, type AccountTier, type UserOrg } from "@/shared/types";
import { OverflowTip } from "@/app/ui/overflow-tip";

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

export function OverLimitBanner() {
  const { org } = useCurrentOrg();
  const clicks = useClickCapNotice();
  if (!org) return null;
  if (org.locked) return <LockedOrgNotice org={org} />;
  if (!isOverLimit(org.over)) return null;
  if (domainsStopped(org)) return <DomainStoppedNotice org={org} />;
  const facts = overFacts(org);
  if (clicks?.reached) facts.push({ label: "Clicks counted", value: clicks.figure, over: true });
  return (
    <Notice
      title={`Over the ${TIER_NAMES[org.tier]} plan`}
      facts={facts}
      action={<BillingLink primary />}
      note={overLimitAdvice(org)}
    />
  );
}

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

const TIER_NAMES = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  enterprise: "Enterprise",
  unlimited: "Unlimited",
} satisfies Record<AccountTier, string>;

function overFacts(org: UserOrg): Fact[] {
  const limits = org.limits;
  // "Custom domains 1 of 0" reads as a glitch: domains are left out of the counts.
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
  const covered = org.limits.orgs;
  return (
    <Notice
      tone="bad"
      title="Read-only"
      facts={[
        {
          label: "Why",
          value: `your plan covers ${covered === 1 ? "one organization" : `${covered} organizations`}`,
        },
        { label: "Links", value: "keep working" },
      ]}
      note={
        org.role === "owner"
          ? "Nothing was deleted. Ask us about Enterprise to use every organization, or make this one active in place of the current one."
          : "Nothing was deleted. Its owner can ask us about Enterprise, or make this the organization they keep active."
      }
      action={
        <div className="flex items-center gap-2">
          {/* Owner-only route: anyone else would get a button whose one outcome is a 403 toast. */}
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
          <BillingLink label="See your plan" primary />
        </div>
      }
    />
  );
}

function overLimitAdvice(org: UserOrg): string {
  const blocked = [
    org.over.links !== undefined && "links",
    org.over.members !== undefined && "members",
  ].filter(Boolean);
  const parts = ["Nothing was deleted and every link still works."];
  if (blocked.length > 0)
    parts.push(`You can't add ${blocked.join(" or ")} until you upgrade or make room.`);
  return parts.join(" ");
}

function monthDay(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ClickCapBanner() {
  const { org } = useCurrentOrg();
  const notice = useClickCapNotice();
  if (!notice) return null;
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
  over?: boolean;
  mono?: boolean;
}

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
          "flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl py-2 pr-2 pl-4 max-sm:flex-col max-sm:items-stretch max-sm:py-3 max-sm:pr-3",
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
            <div key={f.label} className="flex max-w-full min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted">{f.label}</dt>
              <OverflowTip content={f.mono ? f.value : undefined}>
                <dd
                  className={cn(
                    "tnum min-w-0 font-semibold",
                    f.over && "text-danger",
                    f.mono && "truncate font-mono text-[0.8125rem] font-normal",
                  )}
                >
                  {f.value}
                </dd>
              </OverflowTip>
            </div>
          ))}
        </dl>
        {action && <div className="ml-auto max-sm:ml-0">{action}</div>}
      </div>
      {note && <p className="max-w-prose px-1 text-xs text-pretty text-muted">{note}</p>}
    </div>
  );
}

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
