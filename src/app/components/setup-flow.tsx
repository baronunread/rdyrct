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

const ORDER: FlowStep[] = ["name", "link", "domain", "team", "email"];

// Read once, so answering the email question does not pull the step out from under the screen.
function useSteps(): FlowStep[] {
  const user = useCurrentUser().data?.user;
  const skip = Boolean(user?.marketing.asked) || user?.marketingOffered === false;
  const [steps] = useState(() => (skip ? ORDER.filter((s) => s !== "email") : ORDER));
  return steps;
}

export type Payment = "confirming" | "slow" | "paid" | null;
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
  intent: PlanIntent | null;
  start: FlowStep;
  cancelled?: boolean;
  payment: Payment;
  onDone: () => void;
}) {
  const steps = useSteps();
  const { step, leaving, next } = useStepper(org.id, steps, start, onDone);
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? org.name;
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const [domain, setDomain] = useState<string | null>(null);
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

function useStepper(orgId: string, order: FlowStep[], start: FlowStep, onDone: () => void) {
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

function useKeptDomain(org: UserOrg, kept: string | undefined): string | null {
  const domains = useDomains(org.id, org.plan !== "free" && !!kept);
  return kept && domains.data?.some((d) => d.hostname === kept) ? kept : null;
}

function useDomainLive(org: UserOrg, host: string | null): boolean {
  const domains = useDomains(org.id, org.plan !== "free" && !!host);
  return !!domains.data?.some(
    (d) => d.hostname === host && d.status === "active" && d.lockedAt === null,
  );
}

function useFirstClick(orgId: string, hasLink: boolean) {
  const clicks = useQuery({
    ...recentClicksQuery(orgId),
    enabled: hasLink,
    refetchInterval: (q) => (q.state.data?.length ? false : 3000),
  });
  return clicks.data?.[0] ?? null;
}

function useExampleHost(name: string): string {
  const user = useCurrentUser().data?.user;
  return exampleHost(user?.email ?? "", user?.name ?? "", name);
}

// A consumer address gives a person's name ("Maya's links"), a poor domain, so stay generic until they name the org.
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
  kept: string | undefined;
  cancelled: boolean;
  payment: Payment;
  onAdded: (hostname: string) => void;
  onNext: () => void;
}) {
  const paidOnly = payment === "paid" && !kept && org.plan !== "free";
  const next = useEffectEvent(onNext);
  useEffect(() => {
    if (!paidOnly) return;
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

function PaymentDone({ tier }: { tier: AccountTier }) {
  return (
    <div className="flex flex-col">
      <StepHead title={`${TIER_LABEL[tier]} is on`}>Thanks. Next, your team.</StepHead>
    </div>
  );
}

function upsellTitle(confirming: boolean, slow: boolean): string {
  if (slow) return "Still waiting on Polar";
  if (confirming) return "Confirming your payment with Polar";
  return "Use your own domain";
}

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
  confirming: boolean;
  slow: boolean;
  onNext: () => void;
}) {
  const upgrade = useUpgrade();
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
  // Back from checkout with a domain typed before it: add that one, unless a reload already did.
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
  const refresh = () => qc.invalidateQueries({ queryKey: ["invites", org.id] });
  const invite = useMutation({
    mutationFn: ({ addresses, resend }: { addresses: string[]; resend: boolean }) =>
      api<InvitesCreated>(`/orgs/${org.id}/invites`, {
        method: "POST",
        body: { role, emails: addresses, resend },
      }),
    onSuccess: ({ failed }, { addresses }) => {
      void refresh();
      const missed = new Set(failed);
      onInvited(addresses.filter((a) => !missed.has(a)));
      setEmails(failed);
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
    else invite.mutate({ addresses: all, resend: Boolean(invite.data?.failed.length) });
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

function emailsProblem(all: string[]): string | undefined {
  if (!all.length) return "Add an email";
  const bad = all.filter((a) => !isEmail(a));
  if (bad.length === 1) return `Not an email: ${bad[0]}`;
  if (bad.length) return `${bad.length} are not emails`;
  return undefined;
}

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
