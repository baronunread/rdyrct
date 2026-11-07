import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as v from "valibot";
import {
  PLAN_LIMITS,
  YEARLY_DISCOUNT_LABEL,
  type DomainDTO,
  INVITABLE_ROLES,
  type InvitableRole,
  type InvitesCreated,
  type LinkDTO,
  type AccountTier,
  type UserOrg,
} from "@/shared/types";
import { defaultOrgName, workDomain } from "@/shared/org-name";
import { api, ApiError } from "../lib/api";
import {
  useCheckout,
  useCurrentUser,
  useDomainMutations,
  useDomains,
  useLinkMutations,
  recentClicksQuery,
} from "../lib/hooks";
import { orgNameSchema } from "../lib/schemas";
import {
  keepForCheckout,
  PLAN_NAME,
  priceLine,
  setupAt,
  useOrgSetup,
  type PlanIntent,
  type FlowStep,
} from "../lib/setup";
import { Check, Link as LinkIcon } from "@/app/ui/icons";
import { oneOf } from "@/shared/lookup";
import { copyToClipboard } from "../lib/clipboard";
import { ROLE_OPTIONS, isEmail, splitEmails } from "../lib/members-data";
import { MenuSelect } from "../ui/menu";
import { EmailChips } from "./email-chips";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Field, Input } from "../ui/field";
import { Logo } from "../ui/logo";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { Segmented } from "../ui/segmented";
import { DnsRecords } from "./dns-records";
import { ListRow } from "./marketing-prompt";
import { useSetMarketing, type ListChoice } from "../lib/marketing";
import { OrgCard } from "./org-card";

/**
 * A new organization's setup, on a screen of its own between the sign-in
 * card and the app: its name, its first link, a domain of its own, its team,
 * and whether to hear from us by email. One question a screen, each with a way past it. The organization card on
 * the right is what the sign-in card became, and it fills in as the answers
 * come; when the flow is done it becomes the org switcher as the app builds
 * around it (onDone, in routes/welcome.tsx).
 */

const ORDER: FlowStep[] = ["name", "link", "domain", "team", "email"];

/** The steps this account gets: the email question only for one that has
 * not answered it (the one-time dialog, or another tab, may have). Read once,
 * so answering it does not pull the step out from under the screen. */
function useSteps(): FlowStep[] {
  const user = useCurrentUser().data?.user;
  const skip = Boolean(user?.marketing.asked) || user?.marketingOffered === false;
  const [steps] = useState(() => (skip ? ORDER.filter((s) => s !== "email") : ORDER));
  return steps;
}

/** Where a checkout the domain step opened stands, back from Polar: waiting
 * on the webhook, past the wait, or paid. Null when there was none. */
export type Payment = "confirming" | "slow" | "paid" | null;
/** As long as .setup-screen-out runs (styles.css). */
const STEP_OUT_MS = 150;

export function SetupFlow({
  org,
  intent,
  start,
  cancelled = false,
  payment,
  onDone,
}: {
  org: UserOrg;
  /** The plan somebody came in for, if any: the domain step sells that one. */
  intent: PlanIntent | null;
  /** Where to pick up: a checkout from the domain step comes back to it. */
  start: FlowStep;
  /** Back from a checkout the domain step opened, with no payment. */
  cancelled?: boolean;
  /** Back from a checkout the domain step opened, paid or still confirming. */
  payment: Payment;
  onDone: () => void;
}) {
  const steps = useSteps();
  const { step, leaving, next } = useStepper(org.id, steps, start, onDone);
  // The name as typed; the org's own until somebody types.
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? org.name;
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [domain, setDomain] = useState<string | null>(null);
  // What the domain step has typed so far, for the card to show.
  const [typed, setTyped] = useState("");
  const host = useExampleHost(name);
  const kept = useOrgSetup(org.id)?.host;
  const keptAdded = useKeptDomain(org, kept);
  const added = domain ?? keptAdded;
  const domainLive = useDomainLive(org, added);
  const firstClick = useFirstClick(org.id, !!link);
  const screens = {
    name: () => <NameStep org={org} name={name} onName={setName} onNext={next} />,
    link: () => <LinkStep orgId={org.id} link={link} onLink={setLink} onNext={next} />,
    domain: () => (
      <DomainStep
        org={org}
        host={host}
        link={link}
        intent={intent}
        kept={kept}
        cancelled={cancelled}
        payment={payment}
        onAdded={setDomain}
        onTyped={setTyped}
        onNext={next}
      />
    ),
    team: () => (
      <TeamStep
        org={org}
        invited={invited}
        onInvited={(sent) => setInvited((was) => [...was, ...sent])}
        doneLabel={step === steps.at(-1) ? "Open rdyrct" : "Continue"}
        onNext={next}
      />
    ),
    email: () => <EmailStep onNext={next} />,
  } satisfies Record<FlowStep, () => ReactNode>;

  return (
    <div className="flex min-h-dvh flex-col px-5 py-5 sm:px-8">
      <header className="relative flex h-9 items-center">
        <span data-setup-logo className="text-[15px]">
          <Logo />
        </span>
        <Pips steps={steps} at={steps.indexOf(step)} />
      </header>
      <main className="mx-auto grid w-full max-w-[880px] flex-1 grid-cols-[minmax(0,1fr)] items-center gap-10 py-10 md:grid-cols-[minmax(0,1fr)_300px]">
        <section
          key={step}
          className={cn("setup-screen flex max-w-[400px] flex-col", leaving && "setup-screen-out")}
          inert={leaving}
          aria-live="polite"
        >
          {screens[step]()}
        </section>
        <OrgCard
          name={name.trim() || org.name}
          plan={org.plan}
          link={link}
          domain={added ?? (typed || kept || host)}
          domainSet={!!added}
          domainLive={domainLive}
          invited={invited}
          firstClick={firstClick}
          className="max-md:order-first"
        />
      </main>
    </div>
  );
}

/** Which question is on screen. Moving on, the one there steps out,
 * quieter than the next comes in, before the next arrives; the last one
 * ends the flow. The step is kept per browser (lib/setup.ts), so a trip to
 * checkout comes back to it. */
function useStepper(orgId: string, order: FlowStep[], start: FlowStep, onDone: () => void) {
  // A step this account no longer gets (the email question, answered since)
  // resumes on the last one it does.
  const [step, setStep] = useState<FlowStep>(() =>
    order.includes(start) ? start : (order.at(-1) ?? start),
  );
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setupAt(orgId, step), [orgId, step]);
  const next = () => {
    if (leaving) return;
    const after = order[order.indexOf(step) + 1];
    if (!after) return onDone();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setStep(after);
    setLeaving(true);
    window.setTimeout(() => {
      setLeaving(false);
      setStep(after);
    }, STEP_OUT_MS);
  };
  return { step, leaving, next };
}

/** A domain kept through checkout that is already on the org (a reload
 * after the domain step added it). */
function useKeptDomain(org: UserOrg, kept: string | undefined): string | null {
  const domains = useDomains(org.id, org.plan !== "free" && !!kept);
  return kept && domains.data?.some((d) => d.hostname === kept) ? kept : null;
}

/** Whether the added domain is serving yet, so the card can say so. */
function useDomainLive(org: UserOrg, host: string | null): boolean {
  const domains = useDomains(org.id, org.plan !== "free" && !!host);
  return !!domains.data?.some(
    (d) => d.hostname === host && d.status === "active" && d.lockedAt === null,
  );
}

/** The org's first click, asked for every few seconds once there is a
 * link, so opening it during the flow shows up on the card. */
function useFirstClick(orgId: string, hasLink: boolean) {
  const clicks = useQuery({
    ...recentClicksQuery(orgId),
    enabled: hasLink,
    refetchInterval: (q) => (q.state.data?.length ? false : 3000),
  });
  return clicks.data?.[0] ?? null;
}

/** Where a domain of their own would live: theirs if the address says, or
 * one made from the organization's name. */
function useExampleHost(name: string): string {
  const user = useCurrentUser().data?.user;
  return exampleHost(user?.email ?? "", user?.name ?? "", name);
}

/** The work domain, else one made from a name the owner chose. The default
 * name of a consumer address is a person's ("Maya's links"), which makes a
 * poor domain, so it stays generic until they name the org. */
function exampleHost(email: string, userName: string, name: string): string {
  const work = workDomain(email);
  if (work) return `go.${work}`;
  const chosen = name.trim() !== defaultOrgName(email, userName);
  return `go.${(chosen && compact(name)) || "yourbrand"}.com`;
}

const compact = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function Pips({ steps, at }: { steps: FlowStep[]; at: number }) {
  return (
    <span
      className="absolute left-1/2 flex -translate-x-1/2 gap-1.5"
      role="img"
      aria-label={`Step ${at + 1} of ${steps.length}`}
    >
      {steps.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-2 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            i === at ? "w-5" : "w-2",
            i <= at ? "bg-accent" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

function StepHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-2.5 text-sm text-pretty text-muted">{children}</p>
    </>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>;
}

function SkipButton({ onClick, label = "Skip" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" onClick={onClick}>
      {label}
    </Button>
  );
}

/** A reason short enough for a label line, from whatever the server said. */
const reasonFrom = (err: Error, fallback: string) =>
  err instanceof ApiError && err.message.length <= 48 ? err.message : fallback;

function NameStep({
  org,
  name,
  onName,
  onNext,
}: {
  org: UserOrg;
  name: string;
  onName: (name: string) => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (value: string) =>
      api(`/orgs/${org.id}`, { method: "PATCH", body: { name: value } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["user"] });
      onNext();
    },
    onError: (err) => setError(reasonFrom(err, "Could not save it")),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = v.safeParse(orgNameSchema, { name });
    if (!parsed.success) {
      setError(parsed.issues[0].message);
      return;
    }
    if (parsed.output.name === org.name) onNext();
    else save.mutate(parsed.output.name);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <StepHead title="What should we call your organization?">
        Teammates see it in invites, and you see it in the corner. Settings can change it later.
      </StepHead>
      <div className="mt-6">
        <Field label="Name" error={error}>
          <Input
            value={name}
            autoFocus
            maxLength={100}
            onChange={(e) => {
              onName(e.target.value);
              setError(undefined);
            }}
          />
        </Field>
      </div>
      <Actions>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          <BusyContent busy={save.isPending}>Continue</BusyContent>
        </Button>
        <SkipButton
          onClick={() => {
            onName(org.name);
            onNext();
          }}
        />
      </Actions>
    </form>
  );
}

/** How long the made link stays in view before the next question. */
const LINK_BEAT = 1300;

function LinkStep({
  orgId,
  link,
  onLink,
  onNext,
}: {
  orgId: string;
  link: LinkDTO | null;
  onLink: (link: LinkDTO) => void;
  onNext: () => void;
}) {
  const { create } = useLinkMutations(orgId);
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link || create.isPending) return;
    const value = destination.trim();
    if (!value) {
      setError("Paste a link first");
      return;
    }
    create.mutate(
      { destination: value, domainId: null },
      {
        // The link lands in the card; a beat to see it, then on by itself.
        onSuccess: (made) => {
          onLink(made);
          window.setTimeout(onNext, LINK_BEAT);
        },
        onError: (err) => setError(reasonFrom(err, "Could not shorten it")),
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <StepHead title="Shorten your first link">
        Paste any long URL. It gets a short link and a QR code.
      </StepHead>
      <div className="mt-6">
        <Field label="Long link" error={error}>
          <Input
            value={destination}
            autoFocus
            readOnly={!!link}
            placeholder="https://example.com/launch"
            onChange={(e) => {
              setDestination(e.target.value);
              setError(undefined);
            }}
          />
        </Field>
      </div>
      <Actions>
        <Button
          type="submit"
          variant="primary"
          disabled={create.isPending || !!link}
          className={cn(link && "!bg-accent-2 disabled:opacity-100")}
        >
          {link ? (
            <span className="flex items-center gap-1.5">
              <Check size={15} stroke={2.6} className="welcome-check" />
              Link created
            </span>
          ) : (
            <BusyContent busy={create.isPending}>Create link</BusyContent>
          )}
        </Button>
        {!link && <SkipButton onClick={onNext} />}
      </Actions>
    </form>
  );
}

/** Off to Polar for a plan, back through /welcome, where the flow picks up
 * at this step (setupAt). */
function useUpgrade() {
  const checkout = useCheckout();
  const toast = useToast();
  const start = (intent: PlanIntent) =>
    checkout.mutate(
      { plan: intent.target, interval: intent.interval, from: "welcome" },
      {
        onSuccess: ({ url }) => window.location.assign(url),
        onError: () => toast("Checkout did not open. Try again.", "error"),
      },
    );
  return { start, busy: checkout.isPending || checkout.isSuccess };
}

/** The slug a custom domain would let them choose: the last word of the
 * first link's path, as a person would type it. */
function chosenSlug(destination: string | undefined): string {
  try {
    const last = new URL(destination ?? "").pathname.split("/").filter(Boolean).pop() ?? "";
    const slug = last
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
    return slug || "launch";
  } catch {
    return "launch";
  }
}

const shortUrl = (link: LinkDTO) => link.url.replace(/^https?:\/\//, "");

function DomainStep({
  org,
  host,
  link,
  intent,
  kept,
  cancelled,
  payment,
  onAdded,
  onTyped,
  onNext,
}: {
  org: UserOrg;
  host: string;
  link: LinkDTO | null;
  intent: PlanIntent | null;
  onTyped: (hostname: string) => void;
  /** The domain typed before a checkout, waiting to be added. */
  kept: string | undefined;
  /** Back from a checkout with no payment. */
  cancelled: boolean;
  payment: Payment;
  onAdded: (hostname: string) => void;
  onNext: () => void;
}) {
  // Paid with no domain typed: the plan was the point, so on to the team.
  const paidOnly = payment === "paid" && !kept && org.plan !== "free";
  const next = useEffectEvent(onNext);
  useEffect(() => {
    if (!paidOnly) return;
    // Long enough to read that the plan is on.
    const timer = window.setTimeout(next, 1400);
    return () => window.clearTimeout(timer);
  }, [paidOnly]);
  if (paidOnly) return <PaymentDone tier={org.tier} />;
  if (org.plan !== "free")
    return <DomainForm org={org} host={host} kept={kept} onAdded={onAdded} onNext={onNext} />;
  return (
    <DomainUpsell
      orgId={org.id}
      host={host}
      link={link}
      intent={intent}
      kept={kept}
      cancelled={cancelled}
      confirming={payment === "confirming" || payment === "slow"}
      slow={payment === "slow"}
      onTyped={onTyped}
      onNext={onNext}
    />
  );
}

/** The moment between the payment landing and the next step. */
function PaymentDone({ tier }: { tier: AccountTier }) {
  return (
    <div className="flex flex-col">
      <StepHead title={`${TIER_LABEL[tier]} is on`}>Thanks. Next, your team.</StepHead>
    </div>
  );
}

/** The domain step's heading: while it holds for the payment, the heading
 * says so, or the busy button reads as stuck. */
function upsellTitle(confirming: boolean, slow: boolean): string {
  if (slow) return "Still waiting on Polar";
  if (confirming) return "Confirming your payment with Polar";
  return "Use your own domain";
}

/** What the domain step says above its field. */
function upsellLine(cancelled: boolean, confirming: boolean, slow: boolean): string {
  if (slow) return "Polar has not confirmed the payment yet. This step goes on the moment it does.";
  if (confirming) return "Polar tells us when the payment goes through, usually within seconds.";
  if (cancelled) return "No payment went through. Your domain is still here when you want it.";
  return "On your own domain you choose the slug. Domains come with Hobby and Pro.";
}

const INTERVALS = [
  { id: "month", label: "Monthly" },
  { id: "year", label: `Yearly, ${YEARLY_DISCOUNT_LABEL.toLowerCase()}` },
] as const satisfies readonly { id: PlanIntent["interval"]; label: string }[];

const OTHER = { hobby: "pro", pro: "hobby" } as const;

/**
 * The domain step on Free: their link as it is and as it would be on their
 * own domain. On the shared domain every slug is random; choosing it is the
 * one thing only a domain gives, so that is what the step shows. The domain
 * typed here waits through checkout and is added when they come back paid.
 */
function DomainUpsell({
  orgId,
  host,
  link,
  intent,
  kept,
  cancelled,
  confirming,
  slow,
  onTyped,
  onNext,
}: {
  orgId: string;
  onTyped: (hostname: string) => void;
  host: string;
  link: LinkDTO | null;
  intent: PlanIntent | null;
  kept: string | undefined;
  cancelled: boolean;
  /** Back from checkout, the payment not confirmed yet: the step holds. */
  confirming: boolean;
  slow: boolean;
  onNext: () => void;
}) {
  const upgrade = useUpgrade();
  // Opening checkout, or back from it and waiting on the payment.
  const busy = upgrade.busy || confirming;
  const [plan, setPlan] = useState<PlanIntent>(intent ?? { target: "hobby", interval: "month" });
  const [hostname, setHostname] = useState(kept ?? "");
  const [error, setError] = useState<string | undefined>();
  const typed = hostname.trim().toLowerCase();
  const valid = HOSTNAME.test(typed);
  const slug = chosenSlug(link?.destination);
  const type = (value: string) => {
    setHostname(value);
    setError(undefined);
    const next = value.trim().toLowerCase();
    onTyped(HOSTNAME.test(next) ? next : "");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed && !HOSTNAME.test(typed)) {
      setError("Not a domain");
      return;
    }
    keepForCheckout(orgId, typed, plan);
    upgrade.start(plan);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col" aria-busy={confirming}>
      <StepHead title={upsellTitle(confirming, slow)}>
        {upsellLine(cancelled, confirming, slow)}
      </StepHead>
      <div className="mt-6">
        <Field label="Domain" error={error}>
          <Input
            value={hostname}
            autoFocus={!confirming}
            readOnly={confirming}
            placeholder={host}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => type(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {link && <Address label="Now" address={shortUrl(link)} />}
        <Address label="On your domain" address={`${valid ? typed : host}/${slug}`} accent />
      </div>
      <div className="mt-4">
        <Segmented
          label="Billing cycle"
          items={INTERVALS}
          value={plan.interval}
          onChange={(interval) => setPlan({ ...plan, interval })}
        />
      </div>
      <PlanSwitch plan={plan} onPlan={setPlan} />
      <Actions>
        <Button type="submit" variant="primary" disabled={busy}>
          <BusyContent busy={busy}>
            {valid
              ? `Add ${typed} with ${PLAN_NAME[plan.target]}`
              : `${PLAN_NAME[plan.target]}, ${priceLine(plan)}`}
          </BusyContent>
        </Button>
        <SkipButton onClick={onNext} label="Not now" />
      </Actions>
    </form>
  );
}

const PRO_FACTS = `${PLAN_LIMITS.pro.domains} domains, ${PLAN_LIMITS.pro.members} members`;

/** The other paid plan, one click away: Hobby leads, since a domain step
 * needs one domain; Pro is for more. */
function PlanSwitch({ plan, onPlan }: { plan: PlanIntent; onPlan: (plan: PlanIntent) => void }) {
  const pro = plan.target === "pro";
  const other = { ...plan, target: OTHER[plan.target] };
  return (
    <p className="mt-2.5 text-xs text-pretty text-muted">
      {pro ? `Pro: ${PRO_FACTS}. ` : "Need more than one domain? "}
      <button
        type="button"
        onClick={() => onPlan(other)}
        className="cursor-pointer text-accent underline decoration-accent/40 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent"
      >
        {pro ? "Back to Hobby" : "Pro"}, {priceLine(other)}
      </button>
      {pro ? "" : `: ${PRO_FACTS}.`}
    </p>
  );
}

function Address({ label, address, accent }: { label: string; address: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-[10px] bg-surface px-3 py-2.5",
        accent
          ? "shadow-[inset_0_0_0_1.5px_var(--accent)]"
          : "shadow-[inset_0_0_0_1px_var(--border)]",
      )}
    >
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate font-mono text-[13px] font-bold" title={address}>
        {address}
      </span>
    </div>
  );
}

const HOSTNAME = /^(?!https?:)([a-z0-9-]+\.)+[a-z]{2,}$/i;

/**
 * The domain step on a paid plan. A domain kept from before checkout is
 * added on its own; otherwise the field asks for one. Once added, the step
 * shows the record to set, and moves on when they say so: DNS takes its
 * time, and Domains keeps checking.
 */
function DomainForm({
  org,
  host,
  kept,
  onAdded,
  onNext,
}: {
  org: UserOrg;
  host: string;
  kept: string | undefined;
  onAdded: (hostname: string) => void;
  onNext: () => void;
}) {
  const { add } = useDomainMutations(org.id);
  const domains = useDomains(org.id);
  const [hostname, setHostname] = useState(kept ?? "");
  const [error, setError] = useState<string | undefined>();
  const [added, setAdded] = useState<DomainDTO | null>(null);
  const tried = useRef(false);
  const addHost = (value: string) =>
    add.mutate(value, {
      onSuccess: (domain) => {
        setAdded(domain);
        onAdded(domain.hostname);
      },
      onError: (err) => setError(reasonFrom(err, "Could not add it")),
    });
  // Back from checkout with a domain typed before it: add that one, unless
  // a reload already did (then it is in the list, and shown from there).
  const existing = kept ? domains.data?.find((d) => d.hostname === kept) : undefined;
  useEffect(() => {
    if (!kept || tried.current || !domains.data) return;
    tried.current = true;
    if (!existing) addHost(kept);
  });
  const shown = added ?? existing;
  if (shown) return <DomainAdded org={org} domain={shown} onNext={onNext} />;
  if (kept && !error)
    return (
      <div className="flex flex-col">
        <StepHead title={`Adding ${kept}`}>
          You are on {TIER_LABEL[org.tier]}. This takes a few seconds.
        </StepHead>
      </div>
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = hostname.trim().toLowerCase();
    if (!HOSTNAME.test(value)) {
      setError("Not a domain");
      return;
    }
    addHost(value);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <StepHead title="Use your own domain">
        Links on it read as yours, with the slug you choose.
      </StepHead>
      <div className="mt-6">
        <Field label="Domain" error={error}>
          <Input
            value={hostname}
            autoFocus
            placeholder={host}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => {
              setHostname(e.target.value);
              setError(undefined);
            }}
          />
        </Field>
      </div>
      <Actions>
        <Button type="submit" variant="primary" disabled={add.isPending}>
          <BusyContent busy={add.isPending}>Add domain</BusyContent>
        </Button>
        <SkipButton onClick={onNext} label="Not now" />
      </Actions>
    </form>
  );
}

const TIER_LABEL = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  enterprise: "Enterprise",
  unlimited: "Unlimited",
} satisfies Record<AccountTier, string>;

/** The domain is theirs: the record to set, and on. */
function DomainAdded({
  org,
  domain,
  onNext,
}: {
  org: UserOrg;
  domain: DomainDTO;
  onNext: () => void;
}) {
  return (
    <div className="setup-screen flex flex-col">
      <StepHead title={`${domain.hostname} is yours`}>
        You are on {TIER_LABEL[org.tier]}. Add the record below where you manage its DNS, and links
        on it work.
      </StepHead>
      <div className="mt-6">
        <DnsRecords orgId={org.id} domain={domain} />
      </div>
      <p className="mt-2.5 text-xs text-pretty text-muted">
        Usually live within an hour. You can keep going: we check on our own, and Domains says when
        it is live.
      </p>
      <Actions>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </Actions>
    </div>
  );
}

function TeamStep({
  org,
  invited,
  onInvited,
  doneLabel,
  onNext,
}: {
  org: UserOrg;
  invited: string[];
  onInvited: (emails: string[]) => void;
  /** The primary's label once somebody is invited: "Open rdyrct" when
   * the flow ends here (the email question was answered before). */
  doneLabel: string;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const chips = useRef<HTMLInputElement>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  // Set once a send fails: Send then retries those same invites.
  const [retrying, setRetrying] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["invites", org.id] });
  const invite = useMutation({
    mutationFn: (addresses: string[]) =>
      api<InvitesCreated>(`/orgs/${org.id}/invites`, {
        method: "POST",
        body: { role, emails: addresses, resend: retrying },
      }),
    onSuccess: ({ failed }, addresses) => {
      void refresh();
      const missed = new Set(failed);
      onInvited(addresses.filter((a) => !missed.has(a)));
      setEmails(failed);
      setRetrying(failed.length > 0);
      if (failed.length) {
        setError("Couldn't email these. Try again");
        chips.current?.focus();
      }
    },
    onError: (err) => {
      setError(reasonFrom(err, "Could not invite them"));
      chips.current?.focus();
    },
  });
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (invite.isPending) return;
    const all = [...emails, ...splitEmails(draft)];
    setEmails(all);
    setDraft("");
    const reason = emailsProblem(all);
    setError(reason);
    if (reason) chips.current?.focus();
    else invite.mutate(all);
  };
  const count = emails.length + splitEmails(draft).length;
  return (
    <form onSubmit={send} noValidate className="flex flex-col">
      <StepHead title="Invite your team">
        {seatsLine(org)} Type their addresses, or share a link.
      </StepHead>
      <div className="mt-6">
        <EmailChips
          ref={chips}
          label="Emails"
          emails={emails}
          onChange={(next) => {
            setEmails(next);
            setError(undefined);
          }}
          draft={draft}
          onDraftChange={(next) => {
            setDraft(next);
            setError(undefined);
          }}
          error={error}
          placeholder="sam@example.com"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="w-32">
          <MenuSelect
            label="Role"
            value={role}
            onChange={(next) => setRole(oneOf(INVITABLE_ROLES, next, "member"))}
            options={ROLE_OPTIONS}
          />
        </div>
        <Button type="submit" variant="outline" disabled={invite.isPending}>
          <BusyContent busy={invite.isPending}>
            {count > 1 ? `Send ${count} invites` : "Send invite"}
          </BusyContent>
        </Button>
      </div>
      <div className="mt-1.5">
        <InviteLinkButton
          orgId={org.id}
          role={role}
          copied={copied}
          onCopied={() => setCopied(true)}
        />
      </div>
      <p className="mt-2.5 min-h-4 text-xs text-muted tabular-nums" aria-live="polite">
        {invited.length > 0 &&
          `${invited.length} ${invited.length === 1 ? "invite" : "invites"} sent.`}
      </p>
      <Actions>
        <Button variant="primary" onClick={onNext}>
          {invited.length || copied ? doneLabel : "Continue"}
        </Button>
        {!invited.length && !copied && <SkipButton onClick={onNext} label="Not now" />}
      </Actions>
    </form>
  );
}

/** What is wrong with a list of addresses, if anything. */
function emailsProblem(all: string[]): string | undefined {
  if (!all.length) return "Add an email";
  const bad = all.filter((a) => !isEmail(a));
  if (bad.length === 1) return `Not an email: ${bad[0]}`;
  if (bad.length) return `${bad.length} are not emails`;
  return undefined;
}

/** A single-use invite link, made and copied in one press. */
function InviteLinkButton({
  orgId,
  role,
  copied,
  onCopied,
}: {
  orgId: string;
  role: InvitableRole;
  copied: boolean;
  onCopied: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const link = useMutation({
    mutationFn: () =>
      api<InvitesCreated>(`/orgs/${orgId}/invites`, { method: "POST", body: { role } }),
    onSuccess: async ({ invites }) => {
      void qc.invalidateQueries({ queryKey: ["invites", orgId] });
      const token = invites[0]?.token;
      if (!token) return;
      await copyToClipboard(`${window.location.origin}/invite/${token}`, toast, {
        success: "Invite link copied",
      }).catch(() => {});
      onCopied();
    },
    onError: (err) => toast(reasonFrom(err, "Could not make the link"), "error"),
  });
  return (
    <Button
      variant="ghost"
      className="-ml-2.5"
      disabled={link.isPending}
      onClick={() => link.mutate()}
      title="Makes a single-use link, valid 7 days, and copies it"
    >
      <BusyContent busy={link.isPending}>
        <span className="inline-flex items-center gap-1.5">
          {copied ? (
            <Check size={15} aria-hidden className="welcome-check" />
          ) : (
            <LinkIcon size={15} aria-hidden />
          )}
          {copied ? "Copied" : "Copy invite link"}
        </span>
      </BusyContent>
    </Button>
  );
}

/**
 * The last question: product news and offers, a switch each, off unless
 * the account already said yes somewhere (the leaving popup's offers tick).
 * The same two lists as the one-time dialog (components/marketing-prompt.tsx),
 * which an account that answers here never sees. Skip keeps any yes already
 * given and answers no for the rest.
 */
function EmailStep({ onNext }: { onNext: () => void }) {
  const toast = useToast();
  const set = useSetMarketing();
  const marketing = useCurrentUser().data?.user.marketing;
  const already: ListChoice = {
    news: Boolean(marketing?.news),
    offers: Boolean(marketing?.offers),
  };
  const [choice, setChoice] = useState<ListChoice>(already);
  const [pressed, setPressed] = useState<"continue" | "skip" | null>(null);
  const answer = (kind: "continue" | "skip") => {
    if (set.isPending) return;
    setPressed(kind);
    const lists = kind === "continue" ? choice : already;
    set.mutate(
      { source: "onboarding", ...lists },
      { onSuccess: onNext, onError: (err) => toast(reasonFrom(err, "Could not save it"), "error") },
    );
  };
  return (
    <div className="flex flex-col">
      <StepHead title="What should we email you about?">
        Pick any or none. You can change this in Settings.
      </StepHead>
      <div className="mt-6 overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs [&>*+*]:shadow-[inset_0_1px_0_var(--border)]">
        <ListRow
          label="Product news"
          hint="New features and tips"
          checked={choice.news}
          onChange={(news) => setChoice((c) => ({ ...c, news }))}
        />
        <ListRow
          label="Offers"
          hint="Deals on paid plans"
          checked={choice.offers}
          onChange={(offers) => setChoice((c) => ({ ...c, offers }))}
        />
      </div>
      <Actions>
        <Button variant="primary" disabled={set.isPending} onClick={() => answer("continue")}>
          <BusyContent busy={set.isPending && pressed === "continue"}>Continue</BusyContent>
        </Button>
        <Button variant="ghost" disabled={set.isPending} onClick={() => answer("skip")}>
          <BusyContent busy={set.isPending && pressed === "skip"}>Skip</BusyContent>
        </Button>
      </Actions>
    </div>
  );
}

const seatsLine = (org: UserOrg) =>
  org.tier === "unlimited"
    ? "Invite as many as you like."
    : `${TIER_LABEL[org.tier]} includes ${org.limits.members} members.`;
