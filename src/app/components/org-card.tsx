import type { ReactNode } from "react";
import type { LinkDTO, OrgPlan, RecentClick } from "@/shared/types";
import { countryName } from "../lib/places";
import { useCurrentUser } from "../lib/hooks";
import { cn } from "../ui/cn";
import { Badge } from "../ui/misc";
import { QRPreview } from "./qr";

/**
 * The organization as others will see it, while it is being set up
 * (components/setup-flow.tsx): its name, its first link and QR code, the
 * domain it could have, its team. Empty places stay drawn, so what is missing
 * reads as missing. It is what the sign-in card became, and it becomes the
 * org switcher on the way into the app (data-setup-card, setup-arrive in
 * styles.css).
 */
const PLAN_LABEL = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  unlimited: "Unlimited",
} satisfies Record<OrgPlan, string>;

const initial = (text: string) => text.trim().charAt(0).toUpperCase() || "?";
const bare = (url: string) => url.replace(/^https?:\/\//, "");

export function OrgCard({
  name,
  plan,
  link,
  domain,
  domainSet,
  invited,
  firstClick = null,
  className,
}: {
  name: string;
  plan: OrgPlan;
  link: LinkDTO | null;
  domain: string;
  /** The domain was added, rather than shown as what it could be. */
  domainSet: boolean;
  invited: string[];
  /** The first click on the org, once somebody opens the link. */
  firstClick?: RecentClick | null;
  className?: string;
}) {
  return (
    <aside
      data-setup-card
      aria-label="Your organization"
      className={cn(
        "flex flex-col gap-4 rounded-2xl bg-surface p-5 smooth-shadow-ring-xl",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-xl font-bold text-bg"
        >
          {initial(name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[17px] font-semibold" title={name}>
            {name}
          </span>
          <span className="text-xs text-muted">
            {PLAN_LABEL[plan]} · 1 member{invited.length > 0 && `, ${invited.length} invited`}
          </span>
        </span>
      </div>
      <CardRow label="First link">
        <FirstLink link={link} click={firstClick} />
      </CardRow>
      <CardRow label="Domain">
        <Domain domain={domain} set={domainSet} paid={plan !== "free"} />
      </CardRow>
      <CardRow label="Team">
        <Team invited={invited} />
      </CardRow>
    </aside>
  );
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 pt-3.5 shadow-[inset_0_1px_0_var(--border)]">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

function FirstLink({ link, click }: { link: LinkDTO | null; click: RecentClick | null }) {
  if (!link)
    return (
      <div className="grid h-20 place-items-center rounded-[10px] text-xs text-placeholder shadow-[inset_0_0_0_1.5px_var(--border)]">
        Shows here once made
      </div>
    );
  return (
    <div className="setup-arrive-in flex items-center gap-3 rounded-[10px] p-2 smooth-shadow-ring-xs">
      <QRPreview url={link.url} size={64} sizeClass="size-16" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-[13px] font-bold">{bare(link.url)}</span>
        <span className="truncate font-mono text-[11px] text-muted" title={link.destination}>
          {bare(link.destination)}
        </span>
        <span className="text-[11.5px]" aria-live="polite">
          {click ? (
            <span key="click" className="setup-arrive-in inline-block">
              <span className="font-semibold text-accent-2">1 click</span>
              <span className="text-muted">
                {click.country && click.country !== "unknown"
                  ? ` · ${countryName(click.country)}`
                  : ""}
              </span>
            </span>
          ) : (
            <>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent [@media(hover:hover)]:hover:underline"
              >
                Open it ↗
              </a>
              <span className="text-muted"> or scan it</span>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function Domain({ domain, set, paid }: { domain: string; set: boolean; paid: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("truncate font-mono text-[12.5px]", !set && "text-placeholder")}>
        {domain}
      </span>
      {!set && !paid && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">Paid</span>
      )}
      {set && <Badge color="butter">Checking DNS</Badge>}
    </span>
  );
}

/** The team starts with whoever is setting it up; each invite takes a
 * place, and two empty ones say there is room for more. */
function Team({ invited }: { invited: string[] }) {
  const me = initial(useCurrentUser().data?.user.name ?? "");
  const shown = invited.slice(0, 6);
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="grid size-7 place-items-center rounded-lg bg-surface-2 text-xs font-semibold smooth-shadow-ring-xs">
        {me}
      </span>
      {shown.map((email) => (
        <span
          key={email}
          title={`${email}, invited`}
          className="setup-arrive-in grid size-7 place-items-center rounded-lg bg-accent/15 font-mono text-xs text-accent shadow-[inset_0_0_0_1.5px_var(--accent)]"
        >
          {initial(email)}
        </span>
      ))}
      {invited.length > shown.length && (
        <span className="grid h-7 place-items-center px-1 text-xs text-muted tabular-nums">
          +{invited.length - shown.length}
        </span>
      )}
      {invited.length < 2 &&
        Array.from({ length: 2 - invited.length }, (_, i) => (
          <span key={i} className="size-7 rounded-lg shadow-[inset_0_0_0_1.5px_var(--border)]" />
        ))}
    </span>
  );
}
