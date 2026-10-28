import { useState, type FormEvent, type ReactNode, useCallback } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Ellipsis, Globe, Plus } from "@/app/ui/icons";
import type { QueryClient } from "@tanstack/react-query";
import {
  domainsQuery,
  useCurrentUser,
  useConfig,
  useDomains,
  useDomainMutations,
} from "../lib/hooks";
import { settle, type PageContext } from "../lib/route-preload";
import { useCurrentOrg } from "../lib/current-org";
import {
  PLAN_LIMITS,
  type DomainDTO,
  type OrgPlan,
  type OrgRole,
  type UserOrg,
} from "@/shared/types";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Field, Input } from "../ui/field";
import { Dialog } from "../ui/dialog";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { withErrorToast } from "../lib/mutation-toast";
import { hostnameSchema } from "../lib/schemas";
import { PageHeader } from "../ui/misc";
import { SettingsGroup } from "../ui/settings-rows";
import { BusyContent } from "../ui/spinner";
import {
  DomainsHeaderSkeleton,
  DomainsPageSkeleton,
  DomainsSkeleton,
} from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { PaidBadge, UpgradeDialog } from "../components/upgrade-dialog";
import { domainsBlockedBy } from "../lib/org-limits";
import { displayUrl, parentDomain } from "../lib/domain-display";
import { graceLabel, graceRunning } from "../lib/grace";
import { shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";
import { copyToClipboard } from "../lib/clipboard";
import { DnsRecords } from "../components/dns-records";
import { addDomainMessage, recheckMessage } from "../lib/domain-messages";
import posthog from "../lib/posthog";

type Tone = "ok" | "warn" | "bad";

const TONE_CLASS = {
  ok: "text-accent-2",
  warn: "text-butter",
  bad: "text-danger",
} satisfies Record<Tone, string>;

const domainStatus = {
  checking_dns: { tone: "warn", label: "Waiting for DNS" },
  issuing_tls: { tone: "warn", label: "Issuing certificate" },
  active: { tone: "ok", label: "Active" },
  error: { tone: "bad", label: "Failed" },
} satisfies Record<DomainDTO["status"], { tone: Tone; label: string }>;

/** What a domain's status line says: its own status, or for a domain over
 * the plan (#159), whether it still redirects. */
function statusOf(d: DomainDTO, graceEndsAt: number | null): { tone: Tone; label: string } {
  if (d.lockedAt === null) return domainStatus[d.status];
  return graceRunning(graceEndsAt)
    ? { tone: "warn", label: `Stops ${monthDay(graceEndsAt!)}` }
    : { tone: "bad", label: "Stopped" };
}

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const monthDay = (ts: number) => MONTH_DAY.format(new Date(ts));

const transitional = (status: DomainDTO["status"]) =>
  status === "checking_dns" || status === "issuing_tls";

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

  if (!canManageDomains(!!currentUser.data?.user.isAdmin, org.role))
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <PageHeader title="Domains" />
        <p className="text-sm text-muted">You don't have access to domains.</p>
      </div>
    );

  return <DomainsSection orgId={orgId} plan={org.plan} />;
}

/** What the upgrade dialog says a paid plan gives a domain, with the counts
 * from the plans themselves. */
function domainBenefits(): string[] {
  const hobby = PLAN_LIMITS.hobby.domains;
  return [
    "Short links on your own domain",
    "Slugs you choose",
    `${hobby} ${hobby === 1 ? "domain" : "domains"} on Hobby, ${PLAN_LIMITS.pro.domains} on Pro`,
  ];
}

type HostnameForm = { hostname: string };

/** One field and what happens next. A bad hostname marks
 * the field; a refusal from the server goes to a toast. */
function AddDomainDialog({
  open,
  onClose,
  register,
  error,
  onSubmit,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  register: UseFormRegister<HostnameForm>;
  error: string | undefined;
  onSubmit: (e: FormEvent) => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Add a domain">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          label="Domain"
          error={error}
          hint="A subdomain works best, like go.yourbrand.com. Your main site stays where it is."
        >
          <Input
            {...register("hostname")}
            placeholder="links.example.com"
            className="font-mono"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <div className="flex items-center gap-3 rounded-xl p-3 smooth-shadow-ring-xs">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
            <Globe size={15} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Next, one DNS record</p>
            <p className="text-xs text-pretty text-muted">
              We show you the CNAME to add and check it every few seconds.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            <BusyContent busy={pending}>Add domain</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type RedirectEdit = { domain: DomainDTO; value: string };

function RootRedirectDialog({
  editing,
  onChange,
  onClose,
  onSave,
  pending,
}: {
  editing: RedirectEdit | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={!!editing} onOpenChange={(next) => !next && onClose()} title="Root redirect">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <Field
          label="Root redirect"
          hint={
            <>
              Where <span className="font-mono">{editing?.domain.hostname}</span> sends visitors
              with no slug, like your homepage. Leave it empty for a not-found page.
            </>
          }
        >
          <Input
            value={editing?.value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            <BusyContent busy={pending}>Save</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
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

/**
 * Every write the domains page can make, with its toast and its analytics
 * event. Split out of the page so that component is about what it shows and
 * this is about what its buttons do.
 */
function useDomainActions({
  mutations: { add, refresh, setRootRedirect, remove, setDefault },
  org,
  toast,
  closeAdd,
  deleting,
  setDeleting,
  redirectEdit,
  setRedirectEdit,
}: {
  mutations: ReturnType<typeof useDomainMutations>;
  org: UserOrg | null;
  toast: ReturnType<typeof useToast>;
  closeAdd: () => void;
  deleting: DomainDTO | null;
  setDeleting: (d: DomainDTO | null) => void;
  redirectEdit: RedirectEdit | null;
  setRedirectEdit: (edit: RedirectEdit | null) => void;
}) {
  const copy = (text: string) => copyToClipboard(text, toast);

  const addDomain = useCallback(
    ({ hostname }: HostnameForm) => {
      add.mutate(hostname, {
        onSuccess: (d) => {
          posthog.capture("domain_added", { initial_status: d.status });
          closeAdd();
          toast(addDomainMessage(d.status));
        },
        onError: withErrorToast(toast),
      });
    },
    [add, closeAdd, toast],
  );

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

  const saveRedirect = () => {
    if (!redirectEdit) return;
    setRootRedirect.mutate(
      { id: redirectEdit.domain.id, rootRedirect: redirectEdit.value },
      {
        onSuccess: () => {
          posthog.capture("domain_root_redirect_updated");
          setRedirectEdit(null);
          toast("Root redirect updated");
        },
        onError: withErrorToast(toast),
      },
    );
  };

  const toggleDefault = (d: DomainDTO) => {
    const next = org?.defaultDomainId === d.id ? null : d.id;
    setDefault.mutate(next, {
      onSuccess: () => {
        posthog.capture("domain_default_set", { cleared: next === null });
        toast(next ? `New links will use ${d.hostname}` : "New links will use the shared domain");
      },
      onError: withErrorToast(toast),
    });
  };

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

  return { copy, addDomain, recheck, saveRedirect, toggleDefault, confirmDelete };
}

function useDomainsModel(orgId: string, plan: OrgPlan) {
  const domains = useDomains(orgId);
  const mutations = useDomainMutations(orgId);
  const { org } = useCurrentOrg();
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
  const toast = useToast();
  const limits = PLAN_LIMITS[plan];
  const [deleting, setDeleting] = useState<DomainDTO | null>(null);
  const [redirectEdit, setRedirectEdit] = useState<RedirectEdit | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<HostnameForm>({
    resolver: valibotResolver(hostnameSchema),
    defaultValues: { hostname: "" },
  });

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    reset();
  }, [reset]);

  const actions = useDomainActions({
    mutations,
    org,
    toast,
    closeAdd,
    deleting,
    setDeleting,
    redirectEdit,
    setRedirectEdit,
  });

  // A plan with no domains still lists the ones the org already has (#159).
  // Hiding them was the bug: an owner who downgrades and finds an upgrade
  // pitch where their domains used to be concludes we deleted them.
  const hasDomains = !!domains.data?.length;
  // A locked org accepts no writes from anyone, its owner included (#160).
  const canWrite = !org?.locked;
  // The field says what is wrong (rdyrct-design, form errors); react-hook-form
  // moves focus to it.
  const hostnameError = errors.hostname
    ? getValues("hostname").trim()
      ? "Not a valid hostname"
      : "Required"
    : undefined;

  return {
    domains,
    org,
    appHost,
    limits,
    deleting,
    setDeleting,
    redirectEdit,
    setRedirectEdit,
    addOpen,
    openAdd: () => setAddOpen(true),
    closeAdd,
    register,
    hostnameError,
    submit: handleSubmit(actions.addDomain),
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

/**
 * What Add domain does here: open the form, offer the plan, or nothing.
 *
 * A plan without domains and an org with none gets the page a paid plan
 * gets, and Add domain offers the plan instead of the form. An org that kept
 * domains past a downgrade (#159), or a read-only one (#160), gets no
 * button: its rows and the notice above the page say what happened.
 */
function addDomainMode(model: DomainsModel): "add" | "upgrade" | null {
  const blockedBy = domainsBlockedBy(model.limits.domains, !model.canWrite);
  if (blockedBy === null) return "add";
  return blockedBy === "plan" && model.domains.data?.length === 0 ? "upgrade" : null;
}

/** The page's one primary button, badged "Paid" when it offers the plan,
 * with the dialog that offer opens. */
function AddDomainAction({ model }: { model: DomainsModel }) {
  const mode = addDomainMode(model);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  if (mode === null) return null;
  const upgrade = mode === "upgrade";
  return (
    <>
      <Button variant="primary" onClick={upgrade ? () => setUpgradeOpen(true) : model.openAdd}>
        <Plus size={15} aria-hidden />
        Add domain
        {upgrade && <PaidBadge onPrimary />}
      </Button>
      <UpgradeDialog
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Custom domains come with a paid plan"
        benefits={domainBenefits()}
        unlockedBy="hobby"
      />
    </>
  );
}

function DomainsSection({ orgId, plan }: { orgId: string; plan: OrgPlan }) {
  const model = useDomainsModel(orgId, plan);

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <PageHeader
        title="Domains"
        sub={domainsSubtitle(plan, model.domains.data?.length)}
        action={<AddDomainAction model={model} />}
      />
      <div className="flex max-w-[760px] flex-col gap-8">
        <DomainsBody model={model} />
      </div>

      <AddDomainDialog
        open={model.addOpen}
        onClose={model.closeAdd}
        register={model.register}
        error={model.hostnameError}
        onSubmit={model.submit}
        pending={model.pending.adding}
      />
      <RootRedirectDialog
        editing={model.redirectEdit}
        onChange={(value) =>
          model.redirectEdit && model.setRedirectEdit({ ...model.redirectEdit, value })
        }
        onClose={() => model.setRedirectEdit(null)}
        onSave={model.actions.saveRedirect}
        pending={model.pending.savingRedirect}
      />
      <DeleteDomainDialog
        deleting={model.deleting}
        onClose={() => model.setDeleting(null)}
        onConfirm={model.actions.confirmDelete}
        pending={model.pending.removing}
      />
    </div>
  );
}

/** What a serving domain looks like, for the example under the empty state. */
const EXAMPLE_DOMAIN: DomainDTO = {
  id: "example",
  hostname: "go.yourbrand.com",
  status: "active",
  statusReason: "",
  rootRedirect: "https://yourbrand.com",
  validation: "http",
  createdAt: 0,
  lockedAt: null,
};

/**
 * Before the first domain: what will appear, then one faded row drawn by the
 * real row component, so the page shows what a domain looks like here. The
 * same on every plan; only the header button differs. The example is hidden
 * from assistive tech and takes no input: it is a picture, not a domain.
 */
function DomainsEmpty({ appHost }: { appHost: string }) {
  return (
    <SettingsGroup>
      <div className="px-4 py-5">
        <p className="text-sm font-medium">No domains yet</p>
        <p className="mt-0.5 text-xs text-pretty text-muted">
          Add one and your short links read like{" "}
          <span className="font-mono">go.yourbrand.com/launch</span> instead of the shared domain.
        </p>
      </div>
      <div aria-hidden inert data-testid="domain-example" className="select-none">
        <p className="px-4 pt-2.5 text-xs text-muted">Example</p>
        <div className="opacity-50">
          <LazyMotion features={domAnimation}>
            <DomainRow
              domain={EXAMPLE_DOMAIN}
              appHost={appHost}
              orgId=""
              isDefault={false}
              graceEndsAt={null}
              canWrite={false}
              pending={NOTHING_PENDING}
              onToggleDefault={noop}
              onRecheck={noop}
              onEditRedirect={noop}
              onDelete={noop}
              onCopy={noop}
            />
          </LazyMotion>
        </div>
      </div>
    </SettingsGroup>
  );
}

const noop = () => {};

const NOTHING_PENDING: DomainsModel["pending"] = {
  adding: false,
  refreshing: false,
  savingRedirect: false,
  savingDefault: false,
  removing: false,
};

/** The list, or what stands in for it before the first domain. */
function DomainsBody({ model }: { model: DomainsModel }) {
  const { domains, org, appHost, actions, pending } = model;
  if (domains.isLoading) return <DomainsSkeleton />;
  // A read-only org (#160) gets it too, with no button: the notice above
  // the page says why.
  if (!model.hasDomains) return <DomainsEmpty appHost={appHost} />;

  return (
    <SettingsGroup>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}>
          {(domains.data ?? []).map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              appHost={appHost}
              orgId={org?.id ?? ""}
              isDefault={org?.defaultDomainId === d.id}
              graceEndsAt={org?.graceEndsAt ?? null}
              canWrite={model.canWrite}
              pending={pending}
              onToggleDefault={() => actions.toggleDefault(d)}
              onRecheck={() => actions.recheck(d)}
              onEditRedirect={() => model.setRedirectEdit({ domain: d, value: d.rootRedirect })}
              onDelete={() => model.setDeleting(d)}
              onCopy={actions.copy}
            />
          ))}
        </LazyMotion>
      </MotionConfig>
    </SettingsGroup>
  );
}

/**
 * "2 of 5 on your plan" under the title. A plan with no domains that still
 * has some (#159) says why there is no Add button instead: the notice above
 * the page and each row's status say the rest, so no card repeats it.
 */
function domainsSubtitle(plan: OrgPlan, count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  const cap = PLAN_LIMITS[plan].domains;
  if (cap === 0) return count > 0 ? "Custom domains need a paid plan." : undefined;
  // A self-hosted instance has no cap to count against.
  if (plan === "unlimited") return count === 1 ? "1 domain" : `${count} domains`;
  return `${count} of ${cap} on your plan`;
}

/** Slide-in/out variants for the status badge swap: skip the motion (and
 * its delay) when the tab isn't visible, so a backgrounded tab doesn't
 * queue up animation work. */
function statusSlideVariants(tabVisible: boolean) {
  return {
    initial: tabVisible ? { x: 16, opacity: 0 } : { x: 0, opacity: 1 },
    // The way out travels half as far and blurs, so the new status leads.
    exit: tabVisible ? { x: -8, opacity: 0, filter: "blur(4px)" } : { x: 0, opacity: 1 },
    duration: tabVisible ? 0.2 : 0,
  };
}

/** The state as a coloured dot and a word, the way every list in the app
 * says it. The word carries the meaning; the colour only helps the scan. */
function DomainStatus({
  domain: d,
  graceEndsAt,
}: {
  domain: DomainDTO;
  graceEndsAt: number | null;
}) {
  const { initial, exit, duration } = statusSlideVariants(document.visibilityState === "visible");
  const { tone, label } = statusOf(d, graceEndsAt);
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.span
        key={label}
        initial={initial}
        animate={{ x: 0, opacity: 1 }}
        exit={exit}
        transition={{ duration }}
        className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap tnum"
      >
        {/* The dot carries the colour; the word stays in ink, because the
            state colours are under AA as small text on light grounds. */}
        <span aria-hidden className={cn("size-1.5 rounded-full bg-current", TONE_CLASS[tone])} />
        {label}
      </m.span>
    </AnimatePresence>
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
 * One domain: the hostname over one line saying where it stands, its state,
 * and what you can do with it. A pending domain shows the records it still
 * needs under that line.
 */
function DomainRow({
  domain: d,
  appHost,
  orgId,
  isDefault,
  graceEndsAt,
  canWrite,
  pending,
  onToggleDefault,
  onRecheck,
  onEditRedirect,
  onDelete,
  onCopy,
}: {
  domain: DomainDTO;
  appHost: string;
  orgId: string;
  isDefault: boolean;
  /** When the org's grace period ends, for a locked domain's countdown. */
  graceEndsAt: number | null;
  /** False in a locked org, which accepts no writes from anyone (#160). The
   * row still renders: hiding it is how somebody concludes it was deleted. */
  canWrite: boolean;
  pending: DomainsModel["pending"];
  onToggleDefault: () => void;
  onRecheck: () => void;
  onEditRedirect: () => void;
  onDelete: () => void;
  onCopy: (text: string) => void;
}) {
  const locked = d.lockedAt !== null;
  const serving = !locked && d.status === "active";
  // Re-checking is a read, so it stays in a locked org. Only writes go.
  // The default is only offered on a domain that is actually serving (#69):
  // preselecting one still waiting on DNS would hand every new link an
  // address that resolves nowhere, and the server refuses it anyway.
  const items: RowAction[] = [
    ...(!locked && transitional(d.status)
      ? [{ label: "Re-check now", onClick: onRecheck, disabled: pending.refreshing }]
      : []),
    ...(canWrite && serving
      ? [
          {
            label: isDefault
              ? `Stop defaulting to ${d.hostname}`
              : `Default new links to ${d.hostname}`,
            onClick: onToggleDefault,
            disabled: pending.savingDefault,
          },
          { label: "Set root redirect", onClick: onEditRedirect },
        ]
      : []),
    ...(canWrite ? [{ label: "Delete domain", onClick: onDelete, danger: true }] : []),
  ];

  return (
    <div className="flex min-h-[60px] items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm font-bold [overflow-wrap:anywhere]">{d.hostname}</span>
          {isDefault && <span className="text-xs text-muted">Default</span>}
        </p>
        <DomainDetail
          domain={d}
          locked={locked}
          graceEndsAt={graceEndsAt}
          appHost={appHost}
          orgId={orgId}
          onCopy={onCopy}
          onPickPage={canWrite && serving ? onEditRedirect : undefined}
        />
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-0.5">
        <DomainStatus domain={d} graceEndsAt={graceEndsAt} />
        <RowActions hostname={d.hostname} items={items} />
      </div>
    </div>
  );
}

function DetailLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-0.5 text-xs text-pretty text-muted", className)}>{children}</p>;
}

/** The one muted line under a hostname, and for a pending domain the
 * records it still needs. Exactly one state renders per domain. */
function DomainDetail({
  domain: d,
  locked,
  graceEndsAt,
  appHost,
  orgId,
  onCopy,
  onPickPage,
}: {
  domain: DomainDTO;
  locked: boolean;
  graceEndsAt: number | null;
  appHost: string;
  orgId: string;
  onCopy: (text: string) => void;
  /** Opens the root redirect, for a row that can still change it. */
  onPickPage?: () => void;
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
  if (d.status === "active")
    return (
      <DetailLine>
        {d.rootRedirect ? (
          <>
            No slug goes to{" "}
            <span className="font-mono [overflow-wrap:anywhere]" title={d.rootRedirect}>
              {displayUrl(d.rootRedirect)}
            </span>
          </>
        ) : (
          <>
            No slug shows a 404
            {onPickPage && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onPickPage}
                  className="cursor-pointer text-text underline decoration-border underline-offset-2 transition-colors [@media(hover:hover)]:hover:decoration-current"
                >
                  Pick a page
                </button>
              </>
            )}
          </>
        )}
      </DetailLine>
    );
  if (d.validation === "txt")
    return (
      <>
        <DetailLine>
          Moving from another service. Add these TXT records at your DNS provider. We issue the
          certificate while it still points at the old service, then you switch the CNAME.
        </DetailLine>
        <div className="mt-3">
          <DnsRecords orgId={orgId} domain={d} showCname={false} />
        </div>
      </>
    );
  if (d.status === "issuing_tls")
    return (
      <DetailLine>DNS found. The certificate usually takes a few minutes to issue.</DetailLine>
    );
  return (
    <>
      <DetailLine>
        Add this record where you manage {parentDomain(d.hostname)}. We check every few seconds.
      </DetailLine>
      <CnameRecord hostname={d.hostname} appHost={appHost} onCopy={onCopy} />
    </>
  );
}

/** The CNAME a pending domain needs, set into the row rather than boxed. */
function CnameRecord({
  hostname,
  appHost,
  onCopy,
}: {
  hostname: string;
  appHost: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="mt-3 grid max-w-lg grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 rounded-lg bg-bg px-3 py-2 text-xs shadow-[inset_0_0_0_1px_var(--border)]">
      <span className="text-muted">Type</span>
      <span className="text-muted">Name</span>
      <span className="text-muted">Value</span>
      <code className="font-mono">CNAME</code>
      <span className="flex min-w-0 items-center gap-0.5">
        <code className="min-w-0 font-mono break-all">{hostname}</code>
        <CopyButton text={hostname} label="Copy record name" onCopy={onCopy} />
      </span>
      <span className="flex min-w-0 items-center gap-0.5">
        <code className="min-w-0 font-mono break-all">{appHost}</code>
        <CopyButton text={appHost} label="Copy CNAME target" onCopy={onCopy} />
      </span>
    </div>
  );
}
