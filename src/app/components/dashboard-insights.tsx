import type { ReactNode } from "react";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import type { DomainDTO, OrgInsight, OrgInsights, OrgPlan, PlanLimits } from "@/shared/types";
import { exactCount } from "@/shared/click-usage";
import { useClickUsage, useLinkQuotaUsage, useMembers } from "../lib/hooks";
import { useOrgInsights } from "../lib/insights-data";
import { useOrgLimits } from "../lib/org-limits";
import { displayHost } from "../lib/display-url";
import { countryName } from "../lib/places";
import { formatNumber } from "../lib/numbers";
import { HrefLink } from "../lib/router-search";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/skeleton";
import { PanelTabs } from "../ui/tabs";

/** Plans' limits at or above this are "no cap": the self-hosted plan sets
 * them to a million or more, which a meter would only make look absurd. */
const UNCAPPED = 1_000_000;

/** The most sentences the card tells. */
const MAX_INSIGHTS = 4;

type Tone = "up" | "down" | "first" | "warn";

const TONES = {
  up: { icon: IconArrowUp, tile: "bg-mint/15 text-mint" },
  down: { icon: IconArrowDown, tile: "bg-danger/15 text-danger" },
  first: { icon: IconSparkles, tile: "bg-accent/15 text-accent" },
  warn: { icon: IconAlertTriangle, tile: "bg-butter/15 text-butter" },
} satisfies Record<Tone, { icon: Icon; tile: string }>;

interface Sentence {
  key: string;
  tone: Tone;
  title: ReactNode;
  detail: string;
}

/** The earlier period, as the sentence names it. */
function before(days: number): string {
  if (days <= 1) return "the day before";
  if (days === 7) return "last week";
  return `the ${days} days before`;
}

/** The period itself, for the line that says nothing moved. */
function during(days: number): string {
  if (days <= 1) return "in the last day";
  if (days === 7) return "this week";
  if (days === 30) return "this month";
  return `in the last ${days} days`;
}

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "today", "Thursday" or "Oct 5": a UTC day as a person would say it. */
function sinceLabel(day: string, now = Date.now()): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  const ago = Math.floor((now - at) / 86_400_000);
  if (ago <= 0) return "today";
  if (ago === 1) return "yesterday";
  return ago < 7 ? WEEKDAY.format(at) : MONTH_DAY.format(at);
}

const Ident = ({ children }: { children: ReactNode }) => (
  <span className="font-mono">{children}</span>
);

/** One server insight as a sentence and its supporting line. */
function sentenceOf(item: OrgInsight, days: number): Sentence {
  if (item.kind === "country") {
    const name = countryName(item.country);
    const clicks = `${formatNumber(item.current)} clicks`;
    if (item.previous === 0) {
      return {
        key: `country-${item.country}`,
        tone: "first",
        title: `${name} sent its first clicks`,
        detail: `${clicks}, none ${before(days)}`,
      };
    }
    const up = item.current > item.previous;
    return {
      key: `country-${item.country}`,
      tone: up ? "up" : "down",
      title: `${name} is ${up ? "up" : "down"} ${Math.abs(item.pct)}% on ${before(days)}`,
      detail: `${clicks}, ${formatNumber(item.previous)} ${before(days)}`,
    };
  }
  const link = <Ident>/{item.link.slug}</Ident>;
  if (item.kind === "link_fell") {
    return {
      key: `fell-${item.link.id}`,
      tone: "down",
      title: (
        <>
          {link} fell {item.pct}%
        </>
      ),
      detail: `${formatNumber(item.previous)} clicks ${before(days)}`,
    };
  }
  return {
    key: `ref-${item.link.id}-${item.referrer}`,
    tone: "first",
    title: (
      <>
        {link} got its first clicks from <Ident>{item.referrer}</Ident>
      </>
    ),
    detail: `${formatNumber(item.clicks)} ${sinceLabel(item.since) === "today" ? "" : "since "}${sinceLabel(item.since)}`,
  };
}

/** A custom domain that stopped working, or is still waiting for its DNS. */
function domainSentence(domains: DomainDTO[]): Sentence | null {
  const broken = domains.find((d) => d.status === "error");
  const waiting = domains.find((d) => d.status === "checking_dns");
  const d = broken ?? waiting;
  if (!d) return null;
  const host = <Ident>{displayHost(d.hostname)}</Ident>;
  return broken
    ? {
        key: `domain-${d.id}`,
        tone: "warn",
        title: <>{host} stopped working</>,
        detail: d.statusReason || "Check its DNS record.",
      }
    : {
        key: `domain-${d.id}`,
        tone: "warn",
        title: <>{host} is waiting for DNS</>,
        detail: "Add its DNS record to finish setup.",
      };
}

/** Up to four sentences in priority order, or the biggest small move, or
 * nothing. The calm line is the card's to say. */
function sentencesFor(answer: OrgInsights | undefined, domains: DomainDTO[]) {
  const days = answer?.days ?? 7;
  const rows = (answer?.insights ?? []).map((i) => sentenceOf(i, days));
  const domain = domainSentence(domains);
  if (domain) rows.push(domain);
  if (rows.length === 0 && answer?.minor) rows.push(sentenceOf(answer.minor, days));
  return { sentences: rows.slice(0, MAX_INSIGHTS), days };
}

function SentenceRow({ s }: { s: Sentence }) {
  const { icon: Icon, tile } = TONES[s.tone];
  return (
    <li className="flex items-center gap-3">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tile)}>
        <Icon size={16} stroke={1.75} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-pretty [overflow-wrap:anywhere]">{s.title}</span>
        <span className="tnum text-xs text-pretty text-muted">{s.detail}</span>
      </span>
    </li>
  );
}

/** Rows the size of the sentences, so the card does not move when they land. */
function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "What changed": what the range's numbers say against the range before. */
function WhatChanged({
  orgId,
  days,
  domains,
}: {
  orgId: string;
  days: number;
  domains: DomainDTO[];
}) {
  const insights = useOrgInsights(orgId, days);
  const { sentences, days: answered } = sentencesFor(insights.data, domains);
  return (
    <PanelTabs
      className="h-full"
      tabs={[
        {
          value: "changed",
          label: "What changed",
          panel: insights.isPending ? (
            <InsightsSkeleton />
          ) : sentences.length > 0 ? (
            <ul aria-label="What changed" className="flex flex-col gap-3">
              {sentences.map((s) => (
                <SentenceRow key={s.key} s={s} />
              ))}
            </ul>
          ) : (
            <p className="py-1 text-sm text-muted">Nothing stands out {during(answered)}.</p>
          ),
        },
      ]}
    />
  );
}

interface Meter {
  label: string;
  count: number;
  limit: number;
}

/** The share of a cap from which a meter turns to caution. */
const METER_WARN = 0.8;

function MeterRow({ label, count, limit }: Meter) {
  const share = limit > 0 ? count / limit : 1;
  const fill = share >= 1 ? "bg-danger" : share >= METER_WARN ? "bg-butter" : "bg-accent";
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tnum text-muted">
          {exactCount(count)} of {exactCount(limit)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(count, limit)}
        aria-valuetext={`${exactCount(count)} of ${exactCount(limit)}`}
        className="h-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${Math.min(100, Math.max(count > 0 ? 2 : 0, share * 100))}%` }}
        />
      </div>
    </li>
  );
}

const PLAN_TITLE = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "",
} satisfies Record<OrgPlan, string>;

/**
 * The meters worth showing: one per limit the plan has, from what the app
 * already reads for Billing. A limit nobody can reach is left out, and so is
 * custom domains for somebody who may not list them (a member or viewer) or
 * on a plan with none.
 */
function useMeters(orgId: string, limits: PlanLimits, domains: DomainDTO[] | undefined) {
  const links = useLinkQuotaUsage(orgId);
  const members = useMembers(orgId);
  const clicks = useClickUsage(orgId);
  const all: (Meter | null)[] = [
    links.data ? { label: "Links", count: links.data.count, limit: limits.links } : null,
    clicks.data
      ? { label: "Clicks this month", count: clicks.data.clicks, limit: clicks.data.limit }
      : null,
    domains && (limits.domains > 0 || domains.length > 0)
      ? { label: "Custom domains", count: domains.length, limit: limits.domains }
      : null,
    members.data ? { label: "Members", count: members.data.length, limit: limits.members } : null,
  ];
  return {
    meters: all.filter((m): m is Meter => m !== null && m.limit < UNCAPPED),
    pending: links.isPending || members.isPending || clicks.isPending,
  };
}

function MetersSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-1 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** "Your plan": how much of each limit the org has used. */
function YourPlan({ plan, meters, pending }: { plan: OrgPlan; meters: Meter[]; pending: boolean }) {
  return (
    <PanelTabs
      className="h-full"
      tabs={[
        {
          value: "plan",
          label: "Your plan",
          panel: pending ? (
            <MetersSkeleton />
          ) : (
            <ul aria-label="Your plan" className="flex flex-col gap-3.5">
              {meters.map((m) => (
                <MeterRow key={m.label} {...m} />
              ))}
            </ul>
          ),
        },
      ]}
      end={
        <HrefLink
          href="/billing"
          aria-label={`${PLAN_TITLE[plan]} plan, open billing`}
          className="[@media(hover:hover)]:hover:text-text"
        >
          {PLAN_TITLE[plan]}
        </HrefLink>
      }
    />
  );
}

/** The dashboard's last row: what changed beside the plan's meters. */
export function InsightsRow({ days }: { days: number }) {
  const { org, orgId, limits, canListDomains, domains } = useOrgLimits();
  // Only somebody who may list domains has the list to count or to warn from.
  const domainList = canListDomains ? domains.data : undefined;
  const { meters, pending } = useMeters(orgId, limits, domainList);
  const showPlan = org?.plan !== "unlimited" && (pending || meters.length > 0);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className={showPlan ? undefined : "lg:col-span-2"}>
        <WhatChanged orgId={orgId} days={days} domains={domainList ?? []} />
      </div>
      {showPlan && <YourPlan plan={org?.plan ?? "free"} meters={meters} pending={pending} />}
    </div>
  );
}
