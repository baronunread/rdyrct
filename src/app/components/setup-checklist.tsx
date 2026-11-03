import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Link, useLocation } from "@tanstack/react-router";
import type { DomainDTO, RecentClick, UserOrg } from "@/shared/types";
import { useQuery } from "@tanstack/react-query";
import {
  recentClicksQuery,
  useDomains,
  useInvites,
  useLinkQuotaUsage,
  useMembers,
} from "../lib/hooks";
import { hideSetupList, showSetupList, useOrgSetup } from "../lib/setup";
import { countryName } from "../lib/places";
import { relativeDate } from "../lib/dates";
import { Check, Target } from "../ui/icons";
import { MenuItem } from "../ui/menu";
import { cn } from "../ui/cn";
import { LiveStatus } from "../ui/live-status";

/**
 * What is left of a new organization's setup, in the sidebar above the
 * account, the way Linear and Vercel keep theirs: a count, a bar and the next
 * step; open it for the rest. Each step reads live data, so it ticks itself
 * (a click lands, DNS goes live, a teammate joins), and the card goes once
 * all are done or the owner hides it (Setup guide in the account menu brings
 * it back). Free has no domain step: it could never be done there. Only for
 * an org whose setup flow started in this browser (lib/setup.ts): an account
 * that was already in use never sees it.
 */
/** "Setup guide" in the account menu, while the list is hidden and has
 * something left to do: it brings the list back. */
export function SetupGuideItem({ org }: { org: UserOrg | null }) {
  const setup = useOrgSetup(org?.id ?? "");
  if (!org || org.role !== "owner" || org.locked || !setup?.listHidden) return null;
  return <GuideItem org={org} />;
}

function GuideItem({ org }: { org: UserOrg }) {
  const steps = useSteps(org);
  if (!steps || steps.every((s) => s.done)) return null;
  return (
    <MenuItem onClick={() => showSetupList(org.id)}>
      <Target size={15} className="text-muted" /> Setup guide
      <span className="ml-auto text-xs text-muted tabular-nums">
        {steps.filter((s) => s.done).length} of {steps.length}
      </span>
    </MenuItem>
  );
}

export function SetupChecklist({ org, phone }: { org: UserOrg | null; phone?: boolean }) {
  const setup = useOrgSetup(org?.id ?? "");
  if (!org || org.role !== "owner" || org.locked || !setup || setup.listHidden) return null;
  return <Checklist org={org} phone={phone} />;
}

interface Step {
  title: string;
  done: boolean;
  detail: ReactNode;
  status?: ReactNode;
}

function useSteps(org: UserOrg): Step[] | null {
  const paid = org.plan !== "free";
  const links = useLinkQuotaUsage(org.id);
  // Clicks reach the dashboard in batches, about every 10 seconds
  // (worker/click-buffer.ts), so while the first is awaited this asks more
  // often than the dashboard does.
  const clicks = useQuery({
    ...recentClicksQuery(org.id),
    refetchInterval: (q) => (q.state.data?.length ? 30_000 : 5_000),
  });
  const domains = useDomains(org.id, paid);
  const members = useMembers(org.id);
  const invites = useInvites(org.id, true);
  const domainsReady = !paid || !!domains.data;
  if (!links.data || !clicks.data || !domainsReady || !members.data || !invites.data) return null;
  return [
    linkStep(links.data.count),
    clickStep(clicks.data[0]),
    ...(paid ? [domainStep(domains.data ?? [])] : []),
    teamStep(
      members.data.filter((m) => m.role !== "owner"),
      invites.data.length,
    ),
  ];
}

function linkStep(count: number): Step {
  const done = count > 0;
  return {
    title: "Shorten your first link",
    done,
    detail: done ? "Done" : <Go to="/dashboard">Paste one on the dashboard</Go>,
  };
}

function clickStep(latest: RecentClick | undefined): Step {
  if (!latest)
    return {
      title: "Get its first click",
      done: false,
      detail: "Open your link, or scan its QR code. A click shows up here within about 10 seconds.",
    };
  const known = latest.country && latest.country !== "unknown";
  const from = known ? ` from ${countryName(latest.country)}` : "";
  return {
    title: "Get its first click",
    done: true,
    detail: `Latest${from}, ${relativeDate(latest.ts)}`,
  };
}

/** Done once anybody is asked: whether they accept is up to them. */
function teamStep(others: { name: string }[], invited: number): Step {
  const title = "Bring your team";
  if (others.length > 0) return { title, done: true, detail: `${others[0].name} joined` };
  if (invited > 0) return { title, done: true, detail: `${invited} invited` };
  return { title, done: false, detail: <Go to="/members">Invite them from Members</Go> };
}

function domainStep(domains: DomainDTO[]): Step {
  const live = domains.find((d) => d.status === "active");
  const pending = domains.find((d) => d.status === "checking_dns" || d.status === "issuing_tls");
  if (live) return { title: "Use your own domain", done: true, detail: `${live.hostname} is live` };
  if (pending)
    return {
      title: `Point ${pending.hostname} at rdyrct`,
      done: false,
      detail: <Go to="/domains">One DNS record. We check on our own.</Go>,
      status: <LiveStatus done={false} label="Checking DNS" />,
    };
  return {
    title: "Use your own domain",
    done: false,
    detail: <Go to="/domains">Add it in Domains</Go>,
  };
}

function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-accent underline decoration-accent/40 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent"
    >
      {children}
    </Link>
  );
}

function Checklist({ org, phone }: { org: UserOrg; phone?: boolean }) {
  const steps = useSteps(org);
  const { pathname } = useLocation();
  if (!steps) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done);
  return (
    <div className="px-3 pb-1">
      {/* Keyed on the page, so following a link in the list closes it. */}
      <Popover.Root key={pathname}>
        <Popover.Trigger
          data-setup-checklist
          // Hover lightens the surface rather than swapping shadows: the two
          // ring shadows have different layer counts, which cannot animate
          // between and made the edge flicker.
          className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[10px] bg-surface px-3 py-2.5 text-left smooth-shadow-ring-xs transition-[background-color,scale] duration-150 ease-out active:scale-[0.98] [@media(hover:hover)]:hover:bg-surface-2"
        >
          <span className="flex items-baseline justify-between gap-2 text-sm font-semibold">
            Finish setting up
            <span className="text-xs font-normal text-muted tabular-nums">
              {done} of {steps.length}
            </span>
          </span>
          <Progress done={done} total={steps.length} />
          <span className="truncate text-xs text-muted">Next: {next?.title}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side={phone ? "top" : "right"}
            align="end"
            sideOffset={10}
            collisionPadding={8}
            className="z-50"
          >
            <Popover.Popup className="w-[min(360px,calc(100vw-1.5rem))] origin-[var(--transform-origin)] rounded-2xl bg-surface px-4 pt-3.5 pb-1.5 smooth-shadow-ring-xl transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              <div className="flex items-start justify-between gap-3">
                <Popover.Title className="text-sm font-semibold">Finish setting up</Popover.Title>
                <Popover.Close
                  onClick={() => hideSetupList(org.id)}
                  className="-mt-1 -mr-2 cursor-pointer rounded-md px-2 py-1 text-xs text-muted [@media(hover:hover)]:hover:text-text"
                >
                  Hide this list
                </Popover.Close>
              </div>
              <Popover.Description className="mb-1.5 text-xs text-muted">
                {done} of {steps.length} done. This list goes once they all are.
              </Popover.Description>
              <ol className="flex flex-col">
                {steps.map((s) => (
                  <StepRow key={s.title} step={s} />
                ))}
              </ol>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** One bar filled as far as the count, as Vercel's and Stripe's are: steps
 * finish in any order, and segments lit out of order read as which ones,
 * not how far. */
function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
      <span
        className="block h-full origin-left rounded-full bg-mint transition-[scale] duration-300 ease-out"
        style={{ scale: `${done / total} 1` }}
      />
    </span>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 text-sm shadow-[inset_0_-1px_0_var(--border)] last:shadow-none">
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full",
          step.done ? "bg-mint text-surface" : "shadow-[inset_0_0_0_1.5px_var(--border)]",
        )}
      >
        {step.done && <Check size={12} stroke={3} aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn(step.done && "text-muted")}>
          {step.title}
          {step.done && <span className="sr-only"> (done)</span>}
        </span>
        <span className="text-xs text-pretty text-muted">{step.detail}</span>
      </span>
      {step.status}
    </li>
  );
}
