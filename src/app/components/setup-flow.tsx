import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as v from "valibot";
import {
  PLAN_LIMITS,
  PLAN_PRICES,
  type InvitesCreated,
  type LinkDTO,
  type OrgPlan,
  type UserOrg,
} from "@/shared/types";
import { defaultOrgName, workDomain } from "@/shared/org-name";
import { api, ApiError } from "../lib/api";
import { useCheckout, useCurrentUser, useDomainMutations, useLinkMutations } from "../lib/hooks";
import { orgNameSchema } from "../lib/schemas";
import { PLAN_NAME, setupAt, type PlanIntent, type FlowStep } from "../lib/setup";
import { Check } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Field, Input } from "../ui/field";
import { Logo } from "../ui/logo";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { OrgCard } from "./org-card";

/**
 * A new organization's setup, on a screen of its own between the sign-in
 * card and the app: its name, its first link, a domain of its own, its team.
 * One question a screen, each with a way past it. The organization card on
 * the right is what the sign-in card became, and it fills in as the answers
 * come; when the flow is done it becomes the org switcher as the app builds
 * around it (onDone, in routes/welcome.tsx).
 */

const ORDER: FlowStep[] = ["name", "link", "domain", "team"];

export function SetupFlow({
  org,
  intent,
  start,
  onDone,
}: {
  org: UserOrg;
  /** The plan somebody came in for, if any: the domain step sells that one. */
  intent: PlanIntent | null;
  /** Where to pick up: a checkout from the domain step comes back to it. */
  start: FlowStep;
  onDone: () => void;
}) {
  const [step, setStep] = useState<FlowStep>(start);
  const [name, setName] = useState(org.name);
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  useEffect(() => setupAt(org.id, step), [org.id, step]);

  const next = () => {
    const at = ORDER.indexOf(step);
    if (at === ORDER.length - 1) onDone();
    else setStep(ORDER[at + 1]);
  };
  const host = useExampleHost(name);

  return (
    <div className="flex min-h-dvh flex-col px-5 py-5 sm:px-8">
      <header className="relative flex h-9 items-center">
        <span data-setup-logo className="text-[15px]">
          <Logo />
        </span>
        <Pips at={ORDER.indexOf(step)} />
      </header>
      <main className="mx-auto grid w-full max-w-[880px] flex-1 items-center gap-10 py-10 md:grid-cols-[minmax(0,1fr)_300px]">
        <section key={step} className="setup-screen flex max-w-[400px] flex-col" aria-live="polite">
          {step === "name" && <NameStep org={org} name={name} onName={setName} onNext={next} />}
          {step === "link" && (
            <LinkStep orgId={org.id} link={link} onLink={setLink} onNext={next} />
          )}
          {step === "domain" && (
            <DomainStep
              org={org}
              host={host}
              link={link}
              intent={intent}
              onAdded={(h) => {
                setDomain(h);
                next();
              }}
              onNext={next}
            />
          )}
          {step === "team" && (
            <TeamStep org={org} invited={invited} onInvited={setInvited} onNext={next} />
          )}
        </section>
        <OrgCard
          name={name.trim() || org.name}
          plan={org.plan}
          link={link}
          domain={domain ?? host}
          domainSet={!!domain}
          invited={invited}
          className="max-md:order-first"
        />
      </main>
    </div>
  );
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

function Pips({ at }: { at: number }) {
  return (
    <span
      className="absolute left-1/2 flex -translate-x-1/2 gap-1.5"
      role="img"
      aria-label={`Step ${at + 1} of ${ORDER.length}`}
    >
      {ORDER.map((s, i) => (
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
  onAdded,
  onNext,
}: {
  org: UserOrg;
  host: string;
  link: LinkDTO | null;
  intent: PlanIntent | null;
  onAdded: (hostname: string) => void;
  onNext: () => void;
}) {
  if (org.plan !== "free")
    return <DomainForm org={org} host={host} onAdded={onAdded} onNext={onNext} />;
  return <DomainUpsell host={host} link={link} intent={intent} onNext={onNext} />;
}

/**
 * The domain step on Free: their link as it is and as it would be on their
 * own domain. On the shared domain every slug is random; choosing it is the
 * one thing only a domain gives, so that is what the step shows.
 */
function DomainUpsell({
  host,
  link,
  intent,
  onNext,
}: {
  host: string;
  link: LinkDTO | null;
  intent: PlanIntent | null;
  onNext: () => void;
}) {
  const upgrade = useUpgrade();
  const plan = intent ?? { target: "hobby", interval: "month" };
  const slug = chosenSlug(link?.destination);
  return (
    <div className="flex flex-col">
      <StepHead title="Use your own domain">
        On your own domain you choose the slug. On the shared one it is random.
      </StepHead>
      <div className="mt-6 flex flex-col gap-2">
        {link && <Address label="Now" address={shortUrl(link)} />}
        <Address label="On your domain" address={`${host}/${slug}`} accent />
      </div>
      <Actions>
        <Button variant="primary" disabled={upgrade.busy} onClick={() => upgrade.start(plan)}>
          <BusyContent busy={upgrade.busy}>
            {PLAN_NAME[plan.target]}, {PLAN_PRICES[plan.target]} a month
          </BusyContent>
        </Button>
        <SkipButton onClick={onNext} label="Not now" />
      </Actions>
    </div>
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
  onAdded,
  onNext,
}: {
  org: UserOrg;
  host: string;
  onAdded: (hostname: string) => void;
  onNext: () => void;
}) {
  const { add } = useDomainMutations(org.id);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = hostname.trim().toLowerCase();
    if (!HOSTNAME.test(value)) {
      setError(`Needs a domain like ${host}`);
      return;
    }
    add.mutate(value, {
      onSuccess: () => onAdded(value),
      onError: (err) => setError(reasonFrom(err, "Could not add it")),
    });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <StepHead title="Use your own domain">
        Links on it read as yours, with the slug you choose. DNS takes a few minutes; Domains shows
        how far it got.
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function TeamStep({
  org,
  invited,
  onInvited,
  onNext,
}: {
  org: UserOrg;
  invited: string | null;
  onInvited: (email: string) => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const invite = useMutation({
    mutationFn: (address: string) =>
      api<InvitesCreated>(`/orgs/${org.id}/invites`, {
        method: "POST",
        body: { role: "member", emails: [address] },
      }),
    onSuccess: ({ invites }, address) => {
      if (!invites.length) {
        setError("Could not invite them");
        return;
      }
      void qc.invalidateQueries({ queryKey: ["invites", org.id] });
      onInvited(address);
      setEmail("");
    },
    onError: (err) => setError(reasonFrom(err, "Could not invite them")),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value && invited) return onNext();
    if (!EMAIL.test(value)) {
      setError("Needs an email address");
      return;
    }
    invite.mutate(value);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <StepHead title="Invite your team">
        {seatsLine(org.plan)} They get an email with a link.
      </StepHead>
      <div className="mt-6">
        <Field label="Email" error={error}>
          <Input
            type="email"
            value={email}
            autoFocus
            placeholder="sam@example.com"
            autoComplete="off"
            className="font-mono"
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
          />
        </Field>
      </div>
      <Actions>
        <Button type="submit" variant={invited ? "outline" : "primary"} disabled={invite.isPending}>
          <BusyContent busy={invite.isPending}>Invite</BusyContent>
        </Button>
        {invited ? (
          <Button variant="primary" onClick={onNext}>
            Open rdyrct
          </Button>
        ) : (
          <SkipButton onClick={onNext} label="Not now" />
        )}
      </Actions>
    </form>
  );
}

const seatsLine = (plan: OrgPlan) =>
  plan === "unlimited"
    ? "Invite as many as you like."
    : `${plan === "free" ? "Free" : PLAN_NAME[plan]} includes ${PLAN_LIMITS[plan].members} members.`;
