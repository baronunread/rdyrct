import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import * as v from "valibot";
import { Check, Ellipsis, Pencil, Plus } from "@/app/ui/icons";
import type { QueryClient } from "@tanstack/react-query";
import {
  domainsQuery,
  useCurrentUser,
  useConfig,
  useDomains,
  useDomainMutations,
  useLinkHost,
} from "../lib/hooks";
import { settle, type PageContext } from "../lib/route-preload";
import { useCurrentOrg } from "../lib/current-org";
import { resolveDefaultDomainId } from "../lib/default-domain";
import { ApiError } from "../lib/api";
import {
  type PlanLimits,
  type DomainDTO,
  type OrgPlan,
  type OrgRole,
  type UserOrg,
} from "@/shared/types";
import { buttonClass } from "../ui/button-class";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { withErrorToast } from "../lib/mutation-toast";
import { hostnameSchema } from "../lib/schemas";
import { PageHeader } from "../ui/misc";
import { SettingsGroup } from "../ui/settings-rows";
import { Spinner } from "../ui/spinner";
import {
  DomainsHeaderSkeleton,
  DomainsPageSkeleton,
  DomainsSkeleton,
} from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { FeatureLocked, useOwnerLabel } from "../components/plan-upsell";
import { domainsBlockedBy } from "../lib/org-limits";
import { displayUrl, parentDomain } from "../lib/domain-display";
import { displayHost } from "../lib/display-url";
import { graceLabel, graceRunning } from "../lib/grace";
import { relativeDate, shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { LiveStatus } from "../ui/live-status";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";
import { copyToClipboard } from "../lib/clipboard";
import { DnsRecords } from "../components/dns-records";
import { recheckMessage } from "../lib/domain-messages";
import posthog from "../lib/posthog";
import { Tooltip } from "@/app/ui/tooltip";

type Tone = "warn" | "bad";

const TONE_CLASS = {
  warn: "text-butter",
  bad: "text-danger",
} satisfies Record<Tone, string>;

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const monthDay = (ts: number) => MONTH_DAY.format(new Date(ts));

const transitional = (status: DomainDTO["status"]) =>
  status === "checking_dns" || status === "issuing_tls";

/** The house curve (rdyrct-design, motion) for the row and its setup. */
const EASE = [0.32, 0.72, 0, 1] as const;

function canManageDomains(isPlatformAdmin: boolean, role: OrgRole): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

/** Everything the domains page's first frame reads (see
 * lib/route-preload.ts), for whoever gets the list. Config is already in. */
export function preload(qc: QueryClient, orgId: string, { org, user }: PageContext) {
  return canManageDomains(user.user.isAdmin, org.role)
    ? settle([qc.ensureQueryData(domainsQuery(orgId))])
    : Promise.resolve();
}

export function DomainsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();

  // The full skeleton only for somebody who is going to get the full page.
  // A member sees one line saying they have no access, so drawing a domain
  // list for them promises controls that the page then takes away. A free
  // plan gets the same page as a paid one (its Add domain offers the plan),
  // so it gets the same skeleton. The role is already in hand: the only
  // thing still loading is whether this is a platform admin, and that is a
  // handful of people.
  if (currentUser.isLoading)
    return org && canManageDomains(false, org.role) ? (
      <DomainsPageSkeleton />
    ) : (
      <DomainsHeaderSkeleton />
    );
  if (!org) return <NoOrgState />;

  // A plan without domains says so to everyone, whoever may manage them:
  // the lock is about the plan, and the plan is the owner's to change.
  const canManage = canManageDomains(!!currentUser.data?.user.isAdmin, org.role);
  if (!canManage && org.limits.domains === 0)
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <PageHeader title="Domains" />
        <DomainsLocked orgId={orgId} isOwner={false} />
      </div>
    );
  if (!canManage)
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <PageHeader title="Domains" />
        <p className="text-sm text-muted">You don't have access to domains.</p>
      </div>
    );

  return <DomainsSection orgId={orgId} plan={org.plan} limits={org.limits} />;
}

function DeleteDomainDialog({
  deleting,
  onClose,
  onConfirm,
  pending,
}: {
  deleting: DomainDTO | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ConfirmDialog
      title="Delete domain"
      open={!!deleting}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="Delete domain"
      danger
      pending={pending}
    >
      Delete <span className="font-mono font-bold">{deleting?.hostname}</span>? Links still using
      this domain must be moved or deleted first.
    </ConfirmDialog>
  );
}

/** A refusal the field can own (rdyrct-design, form errors), or null for
 * one that goes to a toast. */
function fieldReason(e: Error): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 409) return "Already in use";
  if (e.status === 400) return e.message.length <= 28 ? e.message : "Not a valid domain";
  return null;
}

/**
 * Every write the domains page can make, with its toast and its analytics
 * event. Split out of the page so that component is about what it shows and
 * this is about what its buttons do.
 */
function useDomainActions({
  mutations: { add, refresh, setRootRedirect, remove, setDefault },
  toast,
  deleting,
  setDeleting,
}: {
  mutations: ReturnType<typeof useDomainMutations>;
  toast: ReturnType<typeof useToast>;
  deleting: DomainDTO | null;
  setDeleting: (d: DomainDTO | null) => void;
}) {
  const copy = (text: string) => copyToClipboard(text, toast);

  /** Adds a domain. A refusal about the name comes back for the field. */
  const addDomain = (hostname: string, onAdded: () => void, onFieldError: (r: string) => void) =>
    add.mutate(hostname, {
      onSuccess: (d) => {
        posthog.capture("domain_added", { initial_status: d.status });
        onAdded();
      },
      onError: (e) => {
        const reason = fieldReason(e);
        if (reason) onFieldError(reason);
        else withErrorToast(toast)(e);
      },
    });

  const recheck = (d: DomainDTO) => {
    const oldStatus = d.status;
    refresh.mutate(d.id, {
      onSuccess: (updated) => {
        const message = recheckMessage(oldStatus, updated.status);
        if (message) toast(message);
      },
      onError: withErrorToast(toast),
    });
  };

  /** Saves a root redirect. A refusal about the address comes back for the
   * field in the row. */
  const saveRedirect = (
    d: DomainDTO,
    rootRedirect: string,
    onSaved: () => void,
    onFieldError: (r: string) => void,
  ) =>
    setRootRedirect.mutate(
      { id: d.id, rootRedirect },
      {
        onSuccess: () => {
          posthog.capture("domain_root_redirect_updated");
          onSaved();
          toast(
            rootRedirect
              ? `${d.hostname} with no slug now opens ${displayUrl(rootRedirect)}`
              : `${d.hostname} with no slug shows a 404`,
          );
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 400) onFieldError("Not a web address");
          else withErrorToast(toast)(e);
        },
      },
    );

  /** Makes a domain the default, or the shared domain with null. */
  const makeDefault = (id: string | null, hostname: string) =>
    setDefault.mutate(id, {
      onSuccess: () => {
        posthog.capture("domain_default_set", { cleared: id === null });
        toast(id ? `New links will use ${hostname}` : "New links will use the shared domain");
      },
      onError: withErrorToast(toast),
    });

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        posthog.capture("domain_deleted");
        setDeleting(null);
        toast("Domain deleted");
      },
      onError: withErrorToast(toast),
    });
  };

  return { copy, addDomain, recheck, saveRedirect, makeDefault, confirmDelete };
}

function useDomainsModel(orgId: string, limits: PlanLimits) {
  const domains = useDomains(orgId);
  const mutations = useDomainMutations(orgId);
  const { org } = useCurrentOrg();
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
  const linkHost = useLinkHost();
  const toast = useToast();
  const [deleting, setDeleting] = useState<DomainDTO | null>(null);
  const actions = useDomainActions({ mutations, toast, deleting, setDeleting });

  // A plan with no domains still lists the ones the org already has (#159).
  // Hiding them was the bug: an owner who downgrades and finds an upgrade
  // pitch where their domains used to be concludes we deleted them.
  const hasDomains = !!domains.data?.length;
  // A locked org accepts no writes from anyone, its owner included (#160).
  const canWrite = !org?.locked;

  return {
    domains,
    org,
    appHost,
    linkHost,
    limits,
    deleting,
    setDeleting,
    actions,
    pending: {
      adding: mutations.add.isPending,
      refreshing: mutations.refresh.isPending,
      savingRedirect: mutations.setRootRedirect.isPending,
      savingDefault: mutations.setDefault.isPending,
      removing: mutations.remove.isPending,
    },
    hasDomains,
    canWrite,
  };
}

type DomainsModel = ReturnType<typeof useDomainsModel>;

/** Why a typed hostname cannot be added, before asking the server. */
function hostnameReason(hostname: string): string | null {
  if (!hostname) return "Type a domain";
  return v.safeParse(hostnameSchema, { hostname }).success ? null : "Not a domain";
}

/**
 * Add domain, which widens into its own field where it was clicked
 * (rdyrct-design, "Adding one value grows in place"). Enter or Add submits;
 * the button never greys out, and a bad name says why inside the field and
 * shakes it once. Esc, or a click away with nothing typed, puts the button
 * back. A plan without domains gets none: with no domains the page is the
 * locked state, and an org that kept domains past a downgrade (#159), or a
 * read-only one (#160), has its rows and the notice above the page.
 */
function AddDomainField({ model }: { model: DomainsModel }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [shakes, setShakes] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // After a shake remounts the form, so focus lands in the new input rather
  // than falling to the page with the one that left.
  useEffect(() => {
    if (shakes) input.current?.focus();
  }, [shakes]);
  if (domainsBlockedBy(model.limits.domains, !model.canWrite) !== null) return null;

  const close = () => {
    setOpen(false);
    setValue("");
    setReason(null);
  };
  const refuse = (why: string) => {
    setReason(why);
    setShakes((n) => n + 1);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (model.pending.adding) return;
    const hostname = value.trim().toLowerCase();
    const why = hostnameReason(hostname);
    if (why) return refuse(why);
    model.actions.addDomain(hostname, close, refuse);
  };

  return (
    <div
      className={cn(
        "relative h-9 rounded-[10px] transition-[width,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none max-sm:w-full",
        open
          ? "w-full bg-surface shadow-[0_0_0_1px_var(--border),0_0_0_4px_color-mix(in_oklab,var(--accent)_16%,transparent)] sm:w-80"
          : "w-[8.75rem] bg-accent",
        reason &&
          "shadow-[0_0_0_1px_var(--danger),0_0_0_4px_color-mix(in_oklab,var(--danger)_14%,transparent)]",
      )}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen(true);
          // After the field is in the tree and visible.
          setTimeout(() => input.current?.focus(), 120);
        }}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        className={cn(
          buttonClass({ variant: "primary", className: "absolute inset-0 w-full" }),
          "transition-[opacity,scale] duration-150",
          open && "pointer-events-none opacity-0",
        )}
      >
        <Plus size={15} aria-hidden />
        Add domain
      </button>
      <form
        onSubmit={submit}
        noValidate
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Back to the button the field grew from, before the field goes
          // inert, so keyboard focus stays where it was.
          trigger.current?.focus();
          close();
        }}
        onBlur={(e) => {
          if (!value.trim() && !e.currentTarget.contains(e.relatedTarget)) close();
        }}
        key={shakes}
        className={cn(
          "absolute inset-0 flex items-center gap-2 pr-1 pl-3 transition-[opacity,visibility] delay-75 duration-200",
          open ? "visible opacity-100" : "pointer-events-none invisible opacity-0",
          shakes > 0 && "motion-safe:animate-shake",
        )}
        inert={!open}
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setReason(null);
          }}
          aria-label="Domain"
          aria-invalid={reason ? true : undefined}
          aria-describedby={reason ? "add-domain-reason" : undefined}
          placeholder="go.yourbrand.com"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none! placeholder:text-placeholder"
        />
        {reason && (
          <span id="add-domain-reason" className="text-xs whitespace-nowrap text-danger">
            {reason}
          </span>
        )}
        <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })}>
          {model.pending.adding ? <Spinner /> : "Add"}
        </button>
      </form>
    </div>
  );
}

/** Domains on a plan without them, before any exist: one locked state. */
function DomainsLocked({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const owner = useOwnerLabel(orgId);
  return (
    <FeatureLocked
      title="Custom domains are available on Hobby and Pro."
      line={
        <>
          Your short links on a domain you own, like{" "}
          <span className="font-mono">go.yourbrand.com/spring</span>, with slugs you choose.
        </>
      }
      isOwner={isOwner}
      ownerNote={`Only ${owner} can upgrade.`}
    />
  );
}

function DomainsSection({
  orgId,
  plan,
  limits,
}: {
  orgId: string;
  plan: OrgPlan;
  limits: PlanLimits;
}) {
  const model = useDomainsModel(orgId, limits);
  const defaultHost = defaultHostOf(model.org, model.domains.data, model.linkHost);

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <PageHeader
        title="Domains"
        sub={domainsSubtitle(plan, limits.domains, model.domains.data?.length, defaultHost)}
        action={<AddDomainField model={model} />}
      />
      <div className="flex max-w-[760px] flex-col gap-8">
        <DomainsBody model={model} />
      </div>
      <DeleteDomainDialog
        deleting={model.deleting}
        onClose={() => model.setDeleting(null)}
        onConfirm={model.actions.confirmDelete}
        pending={model.pending.removing}
      />
    </div>
  );
}

/** The host new links start on: the org's default domain, or the shared one. */
function defaultHostOf(
  org: UserOrg | null,
  domains: DomainDTO[] | undefined,
  linkHost: string,
): string {
  const id = servingDefaultId(org, domains);
  return domains?.find((d) => d.id === id)?.hostname ?? linkHost;
}

/** The default new links really start on: the stored one while it serves
 *  (active and unlocked), otherwise none, which is the shared domain. The
 *  link editor's rule (resolveDefaultDomainId), so the page never marks a
 *  domain new links will not use. */
function servingDefaultId(org: UserOrg | null, domains: DomainDTO[] | undefined): string | null {
  const serving = (domains ?? []).filter((d) => d.status === "active" && d.lockedAt === null);
  return resolveDefaultDomainId(org?.defaultDomainId, serving);
}

/** The list, the shared domain last, or the lock before the first domain. */
function DomainsBody({ model }: { model: DomainsModel }) {
  const { domains, org } = model;
  if (domains.isLoading) return <DomainsSkeleton />;
  if (!model.hasDomains && model.limits.domains === 0)
    return <DomainsLocked orgId={org?.id ?? ""} isOwner={org?.role === "owner"} />;

  const list = domains.data ?? [];
  return (
    <SettingsGroup>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}>
          {/* Rows already here render still; a new one enters at the top. */}
          <AnimatePresence initial={false}>
            {list.map((d) => (
              <m.div
                key={d.id}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.35, ease: EASE }}
                className="first:rounded-t-xl"
              >
                <DomainRow domain={d} model={model} />
              </m.div>
            ))}
          </AnimatePresence>
        </LazyMotion>
      </MotionConfig>
      {!model.hasDomains && (
        <p className="px-4 py-3 text-xs text-pretty text-muted">
          No domains yet. Add one and your short links read like{" "}
          <span className="font-mono">go.yourbrand.com/launch</span>, with slugs you choose.
        </p>
      )}
      <SharedDomainRow model={model} />
    </SettingsGroup>
  );
}

/**
 * "2 of 5 · new links start on rdyr.cc" under the title. A plan with no
 * domains that still has some (#159) says why there is no Add domain instead:
 * the notice above the page and each row's status say the rest.
 */
function domainsSubtitle(
  plan: OrgPlan,
  cap: number,
  count: number | undefined,
  defaultHost: string,
): ReactNode {
  if (count === undefined) return undefined;
  if (cap === 0) return count > 0 ? "Custom domains need a paid plan." : undefined;
  // A self-hosted instance has no cap to count against.
  const used =
    plan === "unlimited" ? (count === 1 ? "1 domain" : `${count} domains`) : `${count} of ${cap}`;
  return (
    <>
      <span className="tnum">{used}</span> · new links start on{" "}
      <span
        key={defaultHost}
        className="swap-in inline-flex items-center gap-1.5 rounded-full bg-accent/12 py-px pr-2 pl-1.5 align-[1px] text-text"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        <span className="font-mono text-[13px]">{displayHost(defaultHost)}</span>
      </span>
    </>
  );
}

/** A state the app is not checking: over the plan, or failed. */
function StillStatus({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap tnum">
      {/* The dot carries the colour; the word stays in ink, because the
          state colours are under AA as small text on light grounds. */}
      <span aria-hidden className={cn("size-2 rounded-full bg-current", TONE_CLASS[tone])} />
      {label}
    </span>
  );
}

/** Where a domain stands, on the right of its row. DNS and the certificate
 * are checked by the app, so they are a live status that settles on Live. */
function DomainStatus({
  domain: d,
  graceEndsAt,
}: {
  domain: DomainDTO;
  graceEndsAt: number | null;
}) {
  if (d.lockedAt !== null)
    return graceRunning(graceEndsAt) ? (
      <StillStatus tone="warn" label={`Stops ${monthDay(graceEndsAt!)}`} />
    ) : (
      <StillStatus tone="bad" label="Stopped" />
    );
  if (d.status === "error") return <StillStatus tone="bad" label="Failed" />;
  return (
    <LiveStatus
      done={d.status === "active"}
      label={
        d.status === "active"
          ? "Live"
          : d.status === "issuing_tls"
            ? "Issuing certificate"
            : "Checking DNS"
      }
    />
  );
}

type RowAction = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

/** A row's actions, always behind "…" so every row ends in the same place. */
function RowActions({ hostname, items }: { hostname: string; items: RowAction[] }) {
  // Keeps the column when there is nothing to offer, so the statuses align.
  if (items.length === 0) return <div className="w-8" />;
  const safe = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  return (
    <div className="w-8">
      <Menu
        label={`Actions for ${hostname}`}
        align="end"
        trigger={
          <span className={buttonClass({ variant: "ghost", size: "sm", className: "w-8 px-0" })}>
            <Ellipsis size={16} aria-hidden />
          </span>
        }
      >
        {safe.map((item) => (
          <MenuItem key={item.label} onClick={item.onClick} disabled={item.disabled}>
            {item.label}
          </MenuItem>
        ))}
        {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
        {danger.map((item) => (
          <MenuItem key={item.label} onClick={item.onClick} className="text-danger">
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}

/**
 * The marker at the start of a row (rdyrct-design, "The default is a
 * marker"): filled in the accent with a check on the default, an empty ring
 * on hover for any other domain that can take it.
 */
function DefaultMarker({
  hostname,
  isDefault,
  onPick,
}: {
  hostname: string;
  isDefault: boolean;
  /** Absent when this row cannot be the default (still checking, over the
   * plan, a read-only org). */
  onPick?: () => void;
}) {
  const ring = (
    <span
      aria-hidden
      className="size-[15px] scale-90 rounded-full opacity-0 shadow-[inset_0_0_0_1.5px_var(--border)] transition-[opacity,scale,box-shadow] duration-200 group-hover/row:scale-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
    />
  );
  const dot = (
    <span
      aria-hidden
      className={cn(
        "absolute grid size-4 place-items-center rounded-full bg-accent text-bg transition-[opacity,scale,filter] duration-250 ease-[cubic-bezier(0.2,0,0,1)]",
        isDefault ? "scale-100 opacity-100 blur-[0px]" : "scale-25 opacity-0 blur-[4px]",
      )}
    >
      <Check size={10} stroke={3} />
    </span>
  );
  if (isDefault)
    return (
      <Tooltip content="New links start here">
        <span className="relative grid size-7 shrink-0 place-items-center" aria-label="Default">
          {dot}
        </span>
      </Tooltip>
    );
  if (!onPick) return <span className="size-7 shrink-0" />;
  return (
    <Tooltip content="Make default">
      <button
        type="button"
        onClick={onPick}
        aria-label={`Make ${hostname} the default`}
        className="relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg after:absolute after:-inset-1.5 [@media(hover:hover)]:hover:[&>span:first-child]:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      >
        {ring}
        {dot}
      </button>
    </Tooltip>
  );
}

/**
 * One domain: its default marker, the hostname over one line saying where
 * it stands, its live status, and what you can do with it. A domain still
 * waiting on DNS opens its record under the row, which folds away once the
 * check finds it.
 */
/** The default row's tint: the accent fading out across its first half. */
const DEFAULT_TINT =
  "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent)_7%,transparent),transparent_45%)]";

/** What a domain row's "…" offers. Re-checking is a read, so it stays in a
 * locked org; only writes go. The default is only offered on a domain that
 * is actually serving (#69): preselecting one still waiting on DNS would
 * hand every new link an address that resolves nowhere. */
function domainRowActions(d: DomainDTO, model: DomainsModel, isDefault: boolean): RowAction[] {
  const { canWrite, pending, actions } = model;
  const locked = d.lockedAt !== null;
  const serving = !locked && d.status === "active";
  const items: RowAction[] = [];
  if (!locked && transitional(d.status))
    items.push({
      label: "Re-check now",
      onClick: () => actions.recheck(d),
      disabled: pending.refreshing,
    });
  if (canWrite && serving)
    items.push({
      label: isDefault ? `Stop defaulting to ${d.hostname}` : `Default new links to ${d.hostname}`,
      onClick: () => actions.makeDefault(isDefault ? null : d.id, d.hostname),
      disabled: pending.savingDefault,
    });
  if (canWrite)
    items.push({ label: "Delete domain", onClick: () => model.setDeleting(d), danger: true });
  return items;
}

/** The record under a domain still waiting on DNS. Once the check finds it
 * the status settles first, then this folds. */
function SetupFold({ open, children }: { open: boolean; children: ReactNode }) {
  // Rows from 0fr to 1fr (as the phone menu grows), not a height tween: it
  // reaches the content's own height without animating a layout property.
  // The setup stays mounted until the fold has shut, then goes.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => {
        if (!open && e.target === e.currentTarget) setMounted(false);
      }}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100 delay-100" : "grid-rows-[0fr] opacity-0 delay-[900ms]",
      )}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  );
}

function DomainRow({ domain: d, model }: { domain: DomainDTO; model: DomainsModel }) {
  const { org, canWrite, pending, actions } = model;
  const graceEndsAt = org?.graceEndsAt ?? null;
  const isDefault = servingDefaultId(org, model.domains.data) === d.id;
  const locked = d.lockedAt !== null;
  const canPick = canWrite && !locked && d.status === "active" && !pending.savingDefault;

  return (
    <div
      data-domain={d.hostname}
      className={cn("group/row rounded-[inherit]", isDefault && DEFAULT_TINT)}
    >
      <div className="flex min-h-[60px] items-center gap-3 py-3 pr-4 pl-2.5">
        <DefaultMarker
          hostname={d.hostname}
          isDefault={isDefault}
          onPick={canPick ? () => actions.makeDefault(d.id, d.hostname) : undefined}
        />
        <div className="min-w-0 flex-1">
          <Tooltip content={displayHost(d.hostname) === d.hostname ? undefined : d.hostname}>
            <p className="font-mono text-sm font-bold [overflow-wrap:anywhere]">
              {displayHost(d.hostname)}
            </p>
          </Tooltip>
          <DomainLine domain={d} locked={locked} graceEndsAt={graceEndsAt} model={model} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <DomainStatus domain={d} graceEndsAt={graceEndsAt} />
          <RowActions hostname={d.hostname} items={domainRowActions(d, model, isDefault)} />
        </div>
      </div>
      <SetupFold open={!locked && d.status === "checking_dns"}>
        <DomainSetup domain={d} model={model} />
      </SetupFold>
    </div>
  );
}

/** The shared domain, last: always live, the default when nothing else is. */
function SharedDomainRow({ model }: { model: DomainsModel }) {
  const { org, canWrite, pending, actions, linkHost } = model;
  const isDefault = servingDefaultId(org, model.domains.data) === null;
  return (
    <div className={cn("group/row rounded-b-xl", isDefault && DEFAULT_TINT)}>
      <div className="flex min-h-[60px] items-center gap-3 py-3 pr-4 pl-2.5">
        <DefaultMarker
          hostname={linkHost}
          isDefault={isDefault}
          onPick={
            canWrite && !pending.savingDefault
              ? () => actions.makeDefault(null, linkHost)
              : undefined
          }
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold [overflow-wrap:anywhere]">
            {displayHost(linkHost)}
          </p>
          <p className="mt-0.5 text-xs text-muted">Shared by every account · random slugs</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LiveStatus done label="Live" />
          <div className="w-8" />
        </div>
      </div>
    </div>
  );
}

function DetailLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-0.5 text-xs text-pretty text-muted", className)}>{children}</p>;
}

/** The one muted line under a hostname. A live domain's is its root
 * redirect, which edits in place. Exactly one state renders per domain. */
function DomainLine({
  domain: d,
  locked,
  graceEndsAt,
  model,
}: {
  domain: DomainDTO;
  locked: boolean;
  graceEndsAt: number | null;
  model: DomainsModel;
}) {
  if (locked)
    return (
      <DetailLine className="tnum">
        {graceRunning(graceEndsAt)
          ? `Still redirecting until ${shortDate(graceEndsAt!)} (${graceLabel(graceEndsAt!)}), then it stops.`
          : "Nothing is deleted. Upgrading brings it back with no DNS to redo."}
      </DetailLine>
    );
  if (d.status === "error")
    return (
      <DetailLine>
        {d.statusReason || "Activation failed. Delete and re-add the domain to try again."}
      </DetailLine>
    );
  if (d.status === "active") return <RootRedirectLine domain={d} model={model} />;
  if (d.status === "issuing_tls")
    return <DetailLine>DNS found. The certificate usually takes a few minutes.</DetailLine>;
  return <DetailLine>Added {relativeDate(d.createdAt)}</DetailLine>;
}

/**
 * Where a live domain goes with no slug, as its second line (rdyrct-design,
 * "A single value edits in place"). Clicking it turns the line into a small
 * field: Enter saves, Esc puts the line back, an empty field means a 404.
 */
function RootRedirectLine({ domain: d, model }: { domain: DomainDTO; model: DomainsModel }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(d.rootRedirect);
  const [reason, setReason] = useState<string | null>(null);
  const canEdit = model.canWrite;
  const view = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // When the field closes (saved, or Esc), focus goes back to the line it
  // replaced rather than falling to the page with the input that left.
  useEffect(() => {
    if (wasEditing.current && !editing) view.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  if (!editing)
    return (
      <RootRedirectView
        domain={d}
        canEdit={canEdit}
        buttonRef={view}
        onEdit={() => {
          setValue(d.rootRedirect);
          setReason(null);
          setEditing(true);
        }}
      />
    );
  return (
    <RootRedirectForm
      domain={d}
      model={model}
      value={value}
      reason={reason}
      onChange={(next) => {
        setValue(next);
        setReason(null);
      }}
      onReason={setReason}
      onDone={() => setEditing(false)}
    />
  );
}

/** The redirect as it is: "go.acme.com/ → acme.com", or the 404 note. */
function RootRedirectView({
  domain: d,
  canEdit,
  buttonRef,
  onEdit,
}: {
  domain: DomainDTO;
  canEdit: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      // The address as stored: the line drops the scheme and a trailing slash.
      title={d.rootRedirect || undefined}
      disabled={!canEdit}
      onClick={onEdit}
      className="group/root mt-0.5 inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left text-xs text-muted transition-colors disabled:cursor-default [@media(hover:hover)]:hover:text-text"
    >
      {d.rootRedirect ? (
        <>
          <span className="truncate font-mono">{displayHost(d.hostname)}/</span>
          <span aria-hidden>→</span>
          <span className="truncate font-mono">{displayUrl(d.rootRedirect)}</span>
        </>
      ) : (
        <span>
          No slug shows a 404
          {canEdit && (
            <>
              {" · "}
              <span className="text-accent">Choose a page</span>
            </>
          )}
        </span>
      )}
      {canEdit && (
        <Pencil
          size={12}
          aria-hidden
          className="shrink-0 opacity-0 transition-opacity group-hover/root:opacity-100"
        />
      )}
      <span className="sr-only">Edit the root redirect</span>
    </button>
  );
}

/** The redirect as a small field in the row: Enter saves, Esc puts the
 * line back, a refusal says why inside it. */
function RootRedirectForm({
  domain: d,
  model,
  value,
  reason,
  onChange,
  onReason,
  onDone,
}: {
  domain: DomainDTO;
  model: DomainsModel;
  value: string;
  reason: string | null;
  onChange: (value: string) => void;
  onReason: (reason: string) => void;
  onDone: () => void;
}) {
  const reasonId = useId();
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // One save at a time: a second PATCH could land after a newer one
        // and put back the older address. Save stays pressable (it never
        // greys out); it shows the spinner instead.
        if (model.pending.savingRedirect) return;
        model.actions.saveRedirect(d, value.trim(), onDone, onReason);
      }}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
      className={cn(
        "swap-in mt-1 flex h-7 max-w-sm items-center gap-1.5 rounded-lg bg-bg pr-0.5 pl-2 shadow-[0_0_0_1px_var(--border),0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
        reason &&
          "shadow-[0_0_0_1px_var(--danger),0_0_0_3px_color-mix(in_oklab,var(--danger)_14%,transparent)]",
      )}
    >
      <span className="font-mono text-xs whitespace-nowrap text-placeholder">→</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Where ${d.hostname} with no slug goes`}
        aria-invalid={reason ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        placeholder={`https://${parentDomain(d.hostname)}`}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        // react-doctor-disable-next-line react-doctor/no-autofocus -- the field replaces the line that was just clicked, so focus belongs in it.
        autoFocus
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none! placeholder:text-placeholder"
      />
      {reason && (
        <span id={reasonId} role="alert" className="text-[11px] whitespace-nowrap text-danger">
          {reason}
        </span>
      )}
      <button
        type="submit"
        className={buttonClass({ variant: "primary", size: "sm", className: "h-6 px-2" })}
      >
        {model.pending.savingRedirect ? <Spinner /> : "Save"}
      </button>
    </form>
  );
}

/**
 * The record a domain still needs, under its row: one line saying where it
 * goes, then the record on one line with one copy button that copies it as
 * a message for whoever manages the DNS. A domain moving from another
 * service (#383) lists its TXT records instead.
 */
function DomainSetup({ domain: d, model }: { domain: DomainDTO; model: DomainsModel }) {
  const parent = parentDomain(d.hostname);
  if (d.validation === "txt")
    return (
      <div className="pr-4 pb-4 pl-[3.25rem]">
        <p className="mb-2 text-xs text-pretty text-muted">
          Moving from another service. Add these TXT records where{" "}
          <b className="font-semibold text-text">{parent}</b>'s DNS is managed. We issue the
          certificate while it still points at the old service, then you switch the CNAME.
        </p>
        <DnsRecords orgId={model.org?.id ?? ""} domain={d} showCname={false} />
      </div>
    );
  const record = `Type: CNAME\nName: ${d.hostname}\nValue: ${model.appHost}`;
  return (
    <div className="pr-4 pb-4 pl-[3.25rem]">
      <p className="mb-2 text-xs text-pretty text-muted">
        Add this record where <b className="font-semibold text-text">{parent}</b>'s DNS is managed,
        or send it to whoever looks after it. It usually works within minutes.
      </p>
      <div className="flex h-11 items-center gap-3 rounded-[10px] bg-bg py-1 pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--border)]">
        <span className="shrink-0 rounded-[5px] px-1.5 text-[11px] text-muted shadow-[inset_0_0_0_1px_var(--border)]">
          CNAME
        </span>
        <code className="min-w-0 truncate font-mono text-[13px]">{d.hostname}</code>
        <span aria-hidden className="shrink-0 text-placeholder">
          →
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{model.appHost}</code>
        <CopyButton text={record} label="Copy the record" onCopy={model.actions.copy} />
      </div>
    </div>
  );
}
