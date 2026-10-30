/**
 * The hero card for somebody who already has an account (#96).
 *
 * The anonymous shortener exists to prove the product to a stranger. Showing
 * it to a signed-in visitor is worse than useless: it offers to make a link
 * that expires in 24 hours, counts against a three-per-browser ceiling they
 * have no reason to have, and then offers to "keep" it by signing up for the
 * account they are signed into.
 *
 * Who actually lands here is somebody who typed the bare domain, followed an
 * old bookmark, or came back from the blog, and the likeliest reason is a
 * link to make. So the slot is the anonymous card's bar with the
 * organization as its prefix (hero-link-bar.tsx), making a real link there on
 * its default domain, with one line of how the week went under it.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { ArrowRight, ChevronsUpDown } from "@/app/ui/icons";
import { Menu } from "../ui/menu";
import { cn } from "../ui/cn";
import { OrgMenuItems } from "./org-menu-items";
import { HERO_CARD, HeroBar, HeroFooter, MadeLinkPanel } from "./hero-link-bar";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser, useLinkMutations } from "../lib/hooks";
import { useInsightStats } from "../lib/insights-data";
import { useOrgLimits } from "../lib/org-limits";
import { ApiError } from "../lib/api";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
import { formatNumber } from "../lib/numbers";
import { HrefLink } from "../lib/router-search";
import { buttonClass } from "../ui/button-class";
import { Skeleton, SkeletonStatus } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import type { LinkDTO } from "@/shared/types";

/** No organization yet, so there are no numbers to show and exactly one
 * useful thing to do. */
function NoOrgYet() {
  return (
    <div className={cn(HERO_CARD, "flex flex-col gap-3 p-5")}>
      <p className="text-sm">You are signed in, but you have no organization yet.</p>
      <p className="text-xs text-muted">
        Links belong to an organization. To make one, you only need a name.
      </p>
      <Link
        to="/dashboard"
        className={buttonClass({ variant: "primary", size: "sm", className: "self-start" })}
      >
        Create an organization <ArrowRight size={14} />
      </Link>
    </div>
  );
}

/** The name the card greets: the first word of it, as people say hello. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** The organization as the bar's prefix: its initial on a tinted square,
 *  its name, and a chevron when there is another to pick. */
function OrgChipFace({ name, menu }: { name: string; menu: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-44 min-w-0 items-center gap-1.5 rounded-md bg-surface-2 py-1 pr-2 pl-1 text-xs font-medium text-text",
        menu && "transition-colors hover:text-accent",
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center rounded bg-accent/15 text-[0.625rem] font-bold text-accent uppercase"
      >
        {name.trim().charAt(0)}
      </span>
      <span className="truncate">{name}</span>
      {menu && <ChevronsUpDown size={12} className="shrink-0 text-muted" />}
    </span>
  );
}

/**
 * Which organization the link goes into, because a link in the wrong one is
 * the one mistake this card could make quietly. With more than one, the chip
 * opens the app's own list, and picking makes that the current organization
 * everywhere, as the switcher does.
 */
function OrgChip() {
  const { org, orgs, setOrg } = useCurrentOrg();
  if (!org) return null;
  if (orgs.length < 2) return <OrgChipFace name={org.name} menu={false} />;
  return (
    // The menu's trigger is a box of its own; rounding it keeps the focus
    // ring on the chip's shape.
    <span className="inline-block min-w-0 shrink-0 [&>div]:rounded-md">
      <Menu
        label="Choose the organization for new links"
        trigger={<OrgChipFace name={org.name} menu />}
      >
        <OrgMenuItems orgs={orgs} currentId={org.id} onPick={setOrg} />
      </Menu>
    </span>
  );
}

/** The chip and the slash the slug would follow, as the bar's prefix. */
function OrgPrefix() {
  return (
    <>
      <OrgChip />
      <span aria-hidden="true" className="text-border">
        /
      </span>
    </>
  );
}

function DashboardLink({ children }: { children: string }) {
  return (
    <Link to="/dashboard" className="inline-flex shrink-0 items-center gap-1 hover:text-text">
      {children} <ArrowRight size={13} />
    </Link>
  );
}

const clicksThisWeek = (n: number) =>
  `${formatNumber(n)} ${n === 1 ? "click" : "clicks"} this week`;

/** "Welcome back, Mara · 577 clicks this week": the line before a link. */
function WeekLine({ name, orgId }: { name: string; orgId: string }) {
  const { data } = useInsightStats(orgId);
  // The name arrives with the /user query, and the card can render before it
  // does: the signed-in hint comes from storage. Without the guard that first
  // paint reads "Welcome back, ."
  const first = firstName(name);
  const parts = [first ? `Welcome back, ${first}` : "Welcome back"];
  if (data) parts.push(clicksThisWeek(data.clicks7d));
  return <span className="tnum">{parts.join(" · ")}</span>;
}

/** Where the dashboard keeps a link, for the Edit button under a new one. */
const linkHref = (link: LinkDTO) =>
  link.domain
    ? `/links/${link.slug}?domain=${encodeURIComponent(link.domain)}`
    : `/links/${link.slug}`;

/** The link just made, or the one that already went there, with its QR,
 *  and a footer saying it is kept. */
function Made({ link, existing, orgName }: { link: LinkDTO; existing: boolean; orgName: string }) {
  return (
    <>
      <MadeLinkPanel
        key={link.id}
        url={link.url}
        slug={link.slug}
        detail={existing ? "Already yours: this address had a link" : `from ${link.destination}`}
        actions={
          <HrefLink
            href={linkHref(link)}
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            Edit
          </HrefLink>
        }
      />
      <HeroFooter ruled action={<DashboardLink>Open in dashboard</DashboardLink>}>
        Saved to {orgName}.
      </HeroFooter>
    </>
  );
}

/** Making the link: the dashboard's quick create, on the org's default
 *  domain. A destination that already has a link gets that link back rather
 *  than a second one, said as much. */
function useQuickCreate(orgId: string, domainId: string | null) {
  const toast = useToast();
  const { create } = useLinkMutations(orgId);
  const [made, setMade] = useState<{ link: LinkDTO; existing: boolean } | null>(null);
  const form = useForm({
    resolver: valibotResolver(destinationSchema),
    defaultValues: { destination: "" },
  });
  const show = (link: LinkDTO, existing: boolean) => {
    form.reset({ destination: "" });
    setMade({ link, existing });
  };
  const sameDestination = (e: Error) => {
    if (!(e instanceof ApiError) || e.code !== "same_destination_match") return null;
    // SAFETY: guarded by the same_destination_match code above, and the
    // route that sets that code attaches matchedLinks with it.
    return (e.data as { matchedLinks: LinkDTO[] }).matchedLinks[0] ?? null;
  };
  const submit = form.handleSubmit(
    (data) => {
      if (create.isPending) return;
      create.mutate(
        { destination: data.destination.trim(), domainId },
        {
          onSuccess: (link) => show(link, false),
          onError: (e) => {
            const existing = sameDestination(e);
            if (existing) show(existing, true);
            else withErrorToast(toast)(e);
          },
        },
      );
    },
    () => toast("Enter a valid URL", "error"),
  );
  return { form, submit, made, pending: create.isPending };
}

const LIMIT_TITLE = "Link limit reached: upgrade for more links";
const isBlank = (value: string | undefined) => !value?.trim();
const atLinkLimit = (count: number | undefined, cap: number) => (count ?? 0) >= cap;

/** The bar for an account: the organization as its prefix, dead while the
 *  field is empty or the plan is full, and saying which. */
function QuickBar({
  orgId,
  form,
  pending,
  again,
}: {
  orgId: string;
  form: ReturnType<typeof useQuickCreate>["form"];
  pending: boolean;
  again: boolean;
}) {
  const { limits } = useOrgLimits();
  const { data: stats } = useInsightStats(orgId);
  const atLimit = atLinkLimit(stats?.totalLinks, limits.links);
  const { ref, ...field } = form.register("destination");
  return (
    <HeroBar
      prefix={<OrgPrefix />}
      input={{
        ...field,
        "aria-label": "Destination URL",
      }}
      inputRef={ref}
      disabled={isBlank(form.watch("destination")) || atLimit}
      busy={pending}
      again={again}
      title={atLimit ? LIMIT_TITLE : undefined}
    />
  );
}

/** The card for somebody who can add links: the bar with the organization
 *  as its prefix, then either the week or the link it just made. */
function QuickForm({ name, orgId }: { name: string; orgId: string }) {
  const { org, defaultDomainId } = useOrgLimits();
  const { form, submit, made, pending } = useQuickCreate(orgId, defaultDomainId);

  return (
    <form onSubmit={submit} noValidate className={HERO_CARD}>
      <QuickBar orgId={orgId} form={form} pending={pending} again={made !== null} />
      {made ? (
        <Made {...made} orgName={org?.name ?? "your organization"} />
      ) : (
        <HeroFooter action={<DashboardLink>Dashboard</DashboardLink>}>
          <WeekLine name={name} orgId={orgId} />
        </HeroFooter>
      )}
    </form>
  );
}

/** A viewer can read the org but not add to it: the bar's place says so,
 *  with the chip still there to pick an organization they can add to. */
function QuickLink({ name, orgId }: { name: string; orgId: string }) {
  const { canWrite } = useOrgLimits();
  // Keyed by the org, so a link made for one organization does not linger
  // under the form once another is picked.
  if (canWrite) return <QuickForm key={orgId} name={name} orgId={orgId} />;
  return (
    <div className={HERO_CARD}>
      <div className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-bg p-1 pl-2">
        <OrgPrefix />
        <span className="truncate px-1 text-sm text-muted">
          You can view this organization, not add to it.
        </span>
      </div>
      <HeroFooter action={<DashboardLink>Dashboard</DashboardLink>}>
        <WeekLine name={name} orgId={orgId} />
      </HeroFooter>
    </div>
  );
}

/** The same card while /user is on its way: the bar and the line under it,
 *  so nothing moves when it lands. */
function QuickSkeleton() {
  return (
    // The status wrapper is the flex item the hero centres, so it carries the
    // card's width: without it the card's w-full measures its own contents.
    <SkeletonStatus label="Loading your account…" className="w-full max-w-xl">
      <div className={HERO_CARD}>
        <Skeleton className="h-11 rounded-xl" />
        <div className="px-2 pt-2.5 pb-1">
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
    </SkeletonStatus>
  );
}

export function HeroSignedIn({ name }: { name: string }) {
  const currentUser = useCurrentUser();
  const { org } = useCurrentOrg();
  // The card renders before /user answers, because the signed-in hint comes
  // from storage. Until it does, "you have no organization yet" is a guess,
  // and the wrong one for everybody who has one.
  if (currentUser.isPending) return <QuickSkeleton />;
  if (!org) return <NoOrgYet />;
  return <QuickLink name={name} orgId={org.id} />;
}
