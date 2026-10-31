import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "@/app/ui/icons";
import { PLAN_PRICES, type DomainDTO, type InvitesCreated, type LinkDTO } from "@/shared/types";
import { workDomain } from "@/shared/org-name";
import { api, ApiError } from "../lib/api";
import { useCheckout, useCurrentUser, useDomainMutations } from "../lib/hooks";
import { HrefLink } from "../lib/router-search";
import { PLAN_NAME, priceLine, putOff, type PlanIntent, type SetupStep } from "../lib/setup";
import type { SetupView, StepState } from "../lib/setup-steps";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Field, Input } from "../ui/field";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QRPreview } from "./qr";

/**
 * A new organization's setup, as one list in a fixed order: the plan (only
 * for somebody who came in through a pricing link), the first link, a domain
 * of their own, the team. The first step not yet done is open; a done step
 * closes on what it made, and "Later" closes one without it. See
 * lib/setup-steps.ts for what counts as done.
 */

export function SetupList({
  setup,
  firstLink,
  linkField,
}: {
  setup: SetupView;
  /** The org's first link, for the link step's summary and the domain step's
   * before and after. */
  firstLink: LinkDTO | undefined;
  /** The dashboard's own first-link field. */
  linkField: ReactNode;
}) {
  return (
    <ol className="flex flex-col overflow-hidden rounded-[14px] smooth-shadow-ring-xs">
      {setup.steps.map(({ step, state }, i) => (
        <Step
          key={step}
          index={i}
          state={state}
          open={setup.open === step}
          {...STEP_CONTENT[step]({ state, setup, firstLink, linkField })}
        />
      ))}
    </ol>
  );
}

/** One step's words: its title, what it says on the right once closed,
 * and what it holds while open. */
interface StepContent {
  title: string;
  summary: ReactNode;
  body: ReactNode;
}

/** What a step has to work with. */
interface StepContext {
  state: StepState;
  setup: SetupView;
  firstLink: LinkDTO | undefined;
  linkField: ReactNode;
}

const laterOf = (state: StepState) => (state === "later" ? "Later" : null);

function planStep({ state, setup }: StepContext): StepContent {
  // SAFETY: the plan step is only in the list when there is an intent
  // (setup-steps.ts, `order`).
  const intent = setup.intent!;
  const name = PLAN_NAME[intent.target];
  if (state === "done") return { title: `${name} is on`, summary: priceLine(intent), body: null };
  return {
    title: `Finish upgrading to ${name}`,
    summary: laterOf(state),
    body: <PlanBody orgId={setup.orgId} intent={intent} />,
  };
}

function linkStep({ state, firstLink, linkField }: StepContext): StepContent {
  const made = state === "done" && firstLink;
  return {
    title: "Shorten a link",
    summary: made ? <span className="font-mono">{shortUrl(firstLink)}</span> : null,
    body: linkField,
  };
}

function domainStep({ state, setup, firstLink }: StepContext): StepContent {
  const free = setup.plan === "free";
  const summary =
    state === "done" && setup.domain ? (
      <DomainSummary domain={setup.domain} />
    ) : (
      (laterOf(state) ?? (free ? "Paid" : null))
    );
  return {
    title: "Use your own domain",
    summary,
    body: free ? (
      <DomainUpsell orgId={setup.orgId} firstLink={firstLink} />
    ) : (
      <DomainForm orgId={setup.orgId} />
    ),
  };
}

function teamStep({ state, setup }: StepContext): StepContent {
  return {
    title: "Invite your team",
    summary: state === "done" ? "Invited" : laterOf(state),
    body: <TeamForm orgId={setup.orgId} />,
  };
}

const STEP_CONTENT = {
  plan: planStep,
  link: linkStep,
  domain: domainStep,
  team: teamStep,
} satisfies Record<SetupStep, (context: StepContext) => StepContent>;

const shortUrl = (link: LinkDTO) => link.url.replace(/^https?:\/\//, "");

function Step({
  index,
  state,
  open,
  title,
  summary,
  body,
}: {
  index: number;
  state: StepState;
  open: boolean;
  title: string;
  summary: ReactNode;
  body: ReactNode;
}) {
  const done = state === "done";
  return (
    <li
      data-setup-step={state}
      className={cn("px-4 py-3.5", index > 0 && "shadow-[inset_0_1px_0_var(--border)]")}
    >
      <div className="flex min-h-6 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-200",
            done ? "bg-accent-2 text-bg" : "shadow-[inset_0_0_0_1.5px_var(--border)]",
          )}
        >
          {done && <Check size={12} stroke={3} className="setup-check" />}
        </span>
        <h3 className="text-sm font-semibold">
          {title}
          {done && <span className="sr-only">, done</span>}
        </h3>
        {summary && (
          <span className="ml-auto min-w-0 truncate pl-3 text-xs text-muted">{summary}</span>
        )}
      </div>
      <div
        className="setup-body overflow-hidden"
        style={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        inert={!open}
      >
        {/* Room inside the clip for the lifted field's shadow. */}
        <div className="px-1 pt-3 pb-1.5 sm:pl-[30px]">{body}</div>
      </div>
    </li>
  );
}

function LaterButton({ orgId, step }: { orgId: string; step: SetupStep }) {
  return (
    <Button variant="ghost" onClick={() => putOff(orgId, step)}>
      Later
    </Button>
  );
}

/** Off to Polar for the plan they picked, back through /welcome. */
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

function PlanBody({ orgId, intent }: { orgId: string; intent: PlanIntent }) {
  const upgrade = useUpgrade();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-sm text-pretty text-muted">
        {PLAN_NAME[intent.target]}, {priceLine(intent)}. Checkout keeps the plan you picked.
      </p>
      <Button variant="primary" disabled={upgrade.busy} onClick={() => upgrade.start(intent)}>
        <BusyContent busy={upgrade.busy}>Continue to checkout</BusyContent>
      </Button>
      <LaterButton orgId={orgId} step="plan" />
    </div>
  );
}

function DomainSummary({ domain }: { domain: DomainDTO }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono">{domain.hostname}</span>
      {domain.status !== "active" && (
        <HrefLink href="/domains" className="text-accent underline-offset-4 hover:underline">
          Set up DNS
        </HrefLink>
      )}
    </span>
  );
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

/**
 * The domain step on Free: the link they just made, as it is and as it would
 * be on their own domain. On the shared domain every slug is random; choosing
 * it is the one thing only a domain gives, so that is what the row shows.
 */
function DomainUpsell({ orgId, firstLink }: { orgId: string; firstLink: LinkDTO | undefined }) {
  const user = useCurrentUser();
  const upgrade = useUpgrade();
  const host = `go.${workDomain(user.data?.user.email ?? "") ?? "yourbrand.com"}`;
  const slug = chosenSlug(firstLink?.destination);
  return (
    <div className="flex flex-col gap-2">
      {firstLink && (
        <Comparison
          label="Now"
          address={shortUrl(firstLink)}
          url={firstLink.url}
          note="Random slug"
          className="bg-bg shadow-[inset_0_0_0_1px_var(--border)]"
        />
      )}
      <Comparison
        label="On your domain"
        address={`${host}/${slug}`}
        url={`https://${host}/${slug}`}
        note="Your slug"
        className="bg-surface shadow-[inset_0_0_0_1.5px_var(--accent)]"
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-balance text-muted">
          On any paid plan. Hobby is {PLAN_PRICES.hobby} a month.
        </p>
        <Button
          variant="primary"
          disabled={upgrade.busy}
          onClick={() => upgrade.start({ target: "hobby", interval: "month" })}
        >
          <BusyContent busy={upgrade.busy}>Upgrade</BusyContent>
        </Button>
        <LaterButton orgId={orgId} step="domain" />
      </div>
    </div>
  );
}

function Comparison({
  label,
  address,
  url,
  note,
  className,
}: {
  label: string;
  address: string;
  url: string;
  note: string;
  className: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-[10px] px-3 py-2.5", className)}>
      <QRPreview url={url} size={44} sizeClass="size-11" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted">{label}</span>
        <span className="truncate font-mono text-[13px] font-bold">{address}</span>
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted max-sm:hidden">{note}</span>
    </div>
  );
}

const HOSTNAME = /^(?!https?:)([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** A reason short enough for a label line, from whatever the server said. */
const reasonFrom = (err: Error, fallback: string) =>
  err instanceof ApiError && err.message.length <= 48 ? err.message : fallback;

function DomainForm({ orgId }: { orgId: string }) {
  const { add } = useDomainMutations(orgId);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = hostname.trim().toLowerCase();
    if (!HOSTNAME.test(value)) {
      setError("Needs a domain like go.acme.com");
      return;
    }
    add.mutate(value, { onError: (err) => setError(reasonFrom(err, "Could not add it")) });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Field label="Domain" error={error}>
          <Input
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value);
              setError(undefined);
            }}
            placeholder="go.acme.com"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={add.isPending}>
        <BusyContent busy={add.isPending}>Add domain</BusyContent>
      </Button>
      <LaterButton orgId={orgId} step="domain" />
    </form>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function TeamForm({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const invite = useMutation({
    mutationFn: (address: string) =>
      api<InvitesCreated>(`/orgs/${orgId}/invites`, {
        method: "POST",
        body: { role: "member", emails: [address] },
      }),
    onSuccess: ({ invites }) => {
      if (!invites.length) {
        setError("Could not invite them");
        return;
      }
      toast("Invite sent");
      void qc.invalidateQueries({ queryKey: ["invites", orgId] });
    },
    onError: (err) => setError(reasonFrom(err, "Could not invite them")),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setError("Needs an email address");
      return;
    }
    invite.mutate(value);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Field label="Email" error={error}>
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            placeholder="sam@acme.com"
            autoComplete="off"
            className="font-mono"
          />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={invite.isPending}>
        <BusyContent busy={invite.isPending}>Invite</BusyContent>
      </Button>
      <LaterButton orgId={orgId} step="team" />
    </form>
  );
}
