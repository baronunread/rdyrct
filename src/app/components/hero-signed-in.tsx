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
 * old bookmark, or came back from the blog. They have one question, which is
 * what happened while they were away, so the slot answers that instead.
 */
import { Link } from "react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useCurrentOrg } from "../lib/current-org";
import { useStats } from "../lib/hooks";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import type { OrgStats } from "@/shared/types";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="text-lg font-bold tnum">{value}</p>
      <p className="text-2xs tracking-wider text-muted uppercase">{label}</p>
    </div>
  );
}

/** No organization yet, so there are no numbers to show and exactly one
 * useful thing to do. */
function NoOrgYet() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-xl bg-surface p-5 smooth-shadow-ring-sm">
      <p className="text-sm">You are signed in, but you have no organization yet.</p>
      <p className="text-xs text-muted">
        Links live in an organization. Making one takes a name and nothing else.
      </p>
      <Link to="/dashboard" className="self-start">
        <Button variant="primary" size="sm">
          Create an organization <ArrowRight size={14} />
        </Button>
      </Link>
    </div>
  );
}

/** The two busiest links, which is the other half of "what happened while I
 * was away". Absent on a new account, and an empty list is worse than none. */
function TopLinks({ links }: { links: { id: string; slug: string; clicks: number }[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate font-mono font-bold">/{link.slug}</span>
          <span className="shrink-0 text-muted tnum">{link.clicks.toLocaleString()} clicks</span>
        </div>
      ))}
    </div>
  );
}

/** A quiet week is a real answer, not an error, so it gets a sentence of its
 * own rather than a zero. */
function Greeting({ name, clicks7d }: { name: string; clicks7d: number }) {
  return (
    <div>
      <p className="text-sm font-bold">Welcome back, {name}.</p>
      <p className="mt-0.5 text-xs text-muted">
        {clicks7d > 0
          ? `Your links earned ${clicks7d.toLocaleString()} clicks in the last 7 days.`
          : "No clicks in the last 7 days. Share a link and they will show up here."}
      </p>
    </div>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-xl bg-surface p-5 smooth-shadow-ring-sm">
      {children}
    </div>
  );
}

/** The card once there is an organization and its numbers have arrived. */
function Summary({ name, data }: { name: string; data: OrgStats }) {
  return (
    <CardShell>
      <Greeting name={name} clicks7d={data.clicks7d} />

      <div className="grid grid-cols-3 gap-2">
        <Stat value={data.clicks7d.toLocaleString()} label="Clicks 7d" />
        <Stat value={data.totalLinks.toLocaleString()} label="Links" />
        <Stat value={data.totalClicks.toLocaleString()} label="All time" />
      </div>

      <TopLinks links={data.topLinks.slice(0, 2)} />

      <div className="flex flex-wrap gap-2">
        <Link to="/dashboard">
          <Button variant="primary" size="sm">
            Open dashboard <ArrowRight size={14} />
          </Button>
        </Link>
        <Link to="/links">
          <Button variant="outline" size="sm">
            <Plus size={14} /> New link
          </Button>
        </Link>
      </div>
    </CardShell>
  );
}

/** Split from the component above so the stats query only exists once there
 * is an organization to query. Keeping it in one component meant passing
 * `org?.id ?? ""` and disabling the query on an empty string, which is a
 * workaround for hooks not being conditional rather than a real state. */
function OrgSummary({ name, orgId }: { name: string; orgId: string }) {
  const { data, isPending } = useStats(orgId);
  if (isPending || !data)
    return (
      <CardShell>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardShell>
    );
  return <Summary name={name} data={data} />;
}

export function HeroSignedIn({ name }: { name: string }) {
  const { org } = useCurrentOrg();
  if (!org) return <NoOrgYet />;
  return <OrgSummary name={name} orgId={org.id} />;
}
