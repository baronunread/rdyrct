import { useState, type FormEvent, type ReactNode, useCallback } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Ellipsis, Globe, Plus, Star } from "@/app/ui/icons";
import { useCurrentUser, useConfig, useDomains, useDomainMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import {
  PLAN_LIMITS,
  type DomainDTO,
  type OrgPlan,
  type OrgRole,
  type UserOrg,
} from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Field, Input } from "../ui/field";
import { Dialog } from "../ui/dialog";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { withErrorToast } from "../lib/mutation-toast";
import { hostnameSchema } from "../lib/schemas";
import { Badge, PageHeader } from "../ui/misc";
import { SettingsGroup } from "../ui/settings-rows";
import { BusyContent } from "../ui/spinner";
import { DomainsPageSkeleton, DomainsSkeleton, HeaderSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { LockedPanel } from "../components/over-limit";
import { domainsBlockedBy } from "../lib/org-limits";
import { graceLabel, graceRunning } from "../lib/grace";
import { shortDate } from "../lib/dates";
import { CopyButton } from "../ui/copy-button";
import { Tooltip } from "../ui/tooltip";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";
import { copyToClipboard } from "../lib/clipboard";
import { DnsRecords } from "../components/dns-records";
import { addDomainMessage, recheckMessage } from "../lib/domain-messages";
import posthog from "../lib/posthog";

const domainStatusColor = {
  checking_dns: "butter",
  issuing_tls: "accent",
  active: "mint",
  error: "pink",
} satisfies Record<DomainDTO["status"], "accent" | "butter" | "mint" | "pink">;

const domainStatusLabel = {
  checking_dns: "Checking DNS",
  issuing_tls: "Issuing TLS",
  active: "active",
  error: "Failed",
} satisfies Record<DomainDTO["status"], string>;

const transitional = (status: DomainDTO["status"]) =>
  status === "checking_dns" || status === "issuing_tls";

function canManageDomains(isPlatformAdmin: boolean, role: OrgRole): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

export function DomainsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();

  // The full skeleton only for somebody who is going to get the full page.
  // A member sees one line saying they have no access, and a free plan sees
  // an upgrade row, so drawing a domain list for either promises controls
  // that the page then takes away. Role and plan are both already in hand:
  // the only thing still loading is whether this is a platform admin, and
  // that is a handful of people.
  if (currentUser.isLoading)
    return org && canManageDomains(false, org.role) && PLAN_LIMITS[org.plan].domains > 0 ? (
      <DomainsPageSkeleton />
    ) : (
      <HeaderSkeleton />
    );
  if (!org) return <NoOrgState />;

  if (!canManageDomains(!!currentUser.data?.user.isAdmin, org.role))
    return (
      <div>
        <PageHeader title="Domains" />
        <p className="text-sm text-muted">You don't have access to domains.</p>
      </div>
    );

  return <DomainsSection orgId={orgId} plan={org.plan} />;
}

function UpgradeDomainsGroup() {
  return (
    <LockedPanel
      title="Custom domains are a paid feature"
      reason="Serve your short links from your own domain, with slugs you choose."
      cta="Upgrade to add a domain"
      primary
    />
  );
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
        <div className="flex items-start gap-3">
          <Globe size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Next, one DNS record</p>
            <p className="text-xs text-muted">
              We show you the CNAME to add and check for it every few seconds.
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

function DomainsSection({ orgId, plan }: { orgId: string; plan: OrgPlan }) {
  const model = useDomainsModel(orgId, plan);
  const upgradeOnly = model.limits.domains === 0 && !model.hasDomains;
  const blockedBy = domainsBlockedBy(model.limits.domains, !model.canWrite);
  const canAdd = !upgradeOnly && blockedBy === null;

  return (
    <div>
      <PageHeader
        title="Domains"
        action={
          canAdd ? (
            <Button variant="primary" onClick={model.openAdd}>
              <Plus size={15} aria-hidden />
              Add domain
            </Button>
          ) : undefined
        }
      />
      <div className="flex max-w-[760px] flex-col gap-8">
        {upgradeOnly ? (
          <UpgradeDomainsGroup />
        ) : (
          <>
            <DomainsBody model={model} canAdd={canAdd} />
            <DomainsBlocked blockedBy={blockedBy} />
          </>
        )}
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

/** The list, or the line that stands in for it before the first domain. */
function DomainsBody({ model, canAdd }: { model: DomainsModel; canAdd: boolean }) {
  const { domains, org, appHost, actions, pending } = model;
  if (domains.isLoading) return <DomainsSkeleton />;
  if (!model.hasDomains)
    return canAdd ? (
      <SettingsGroup>
        <div className="px-4 py-5">
          <p className="text-sm font-medium">No domains yet</p>
          <p className="mt-0.5 text-xs text-pretty text-muted">
            Add one and your short links read like{" "}
            <span className="font-mono">go.yourbrand.com/launch</span> instead of the shared domain.
          </p>
        </div>
      </SettingsGroup>
    ) : null;

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
 * Why there is no "Add domain" button: the org is locked, or the plan has no
 * domains (#159, #160). Shown under the list, which stays, because a
 * read-only list with no reason beside it looks like a bug.
 */
function DomainsBlocked({ blockedBy }: { blockedBy: ReturnType<typeof domainsBlockedBy> }) {
  // The banner at the top of the page already says why and until when, and
  // each row says whether it still redirects, so this only says why adding
  // is gone.
  if (blockedBy === "lock")
    return (
      <LockedPanel
        title="This organization is locked"
        reason="You cannot add a domain until it is active again. The domains it already has keep redirecting."
      />
    );
  if (blockedBy === "plan")
    return (
      <LockedPanel
        title="Your custom domains are locked"
        reason="Custom domains need a paid plan. The DNS record, the certificate and every link on these domains are still here."
        cta="Upgrade to keep them"
      />
    );
  return null;
}

/** Slide-in/out variants for the status badge swap: skip the motion (and
 * its delay) when the tab isn't visible, so a backgrounded tab doesn't
 * queue up animation work. */
function statusSlideVariants(tabVisible: boolean) {
  return {
    initial: tabVisible ? { x: 16, opacity: 0 } : { x: 0, opacity: 1 },
    exit: tabVisible ? { x: -16, opacity: 0 } : { x: 0, opacity: 1 },
    duration: tabVisible ? 0.2 : 0,
  };
}

function DomainStatusBadge({ domain: d, locked }: { domain: DomainDTO; locked: boolean }) {
  const { initial, exit, duration } = statusSlideVariants(document.visibilityState === "visible");
  if (locked) return <Badge color="butter">locked</Badge>;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.span
        key={d.status}
        initial={initial}
        animate={{ x: 0, opacity: 1 }}
        exit={exit}
        transition={{ duration }}
        className="inline-flex"
      >
        <Badge color={domainStatusColor[d.status]}>{domainStatusLabel[d.status]}</Badge>
      </m.span>
    </AnimatePresence>
  );
}

/**
 * Makes this domain the one new links start on, or gives that up (#69).
 *
 * Only offered on a domain that is actually serving: preselecting one still
 * waiting on DNS would hand every new link an address that resolves nowhere,
 * and the server refuses it anyway.
 */
function DefaultDomainButton({
  domain: d,
  isDefault,
  pending,
  onToggle,
}: {
  domain: DomainDTO;
  isDefault: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const label = isDefault
    ? `Stop defaulting to ${d.hostname}`
    : `Default new links to ${d.hostname}`;
  return (
    <Tooltip content={label}>
      <IconButton label={label} title={undefined} disabled={pending} onClick={onToggle}>
        <Star size={15} className={isDefault ? "fill-accent text-accent" : ""} />
      </IconButton>
    </Tooltip>
  );
}

type RowAction = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

/** A row's actions: one is a button, more go behind "…". */
function RowActions({ hostname, items }: { hostname: string; items: RowAction[] }) {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [only] = items;
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={only.disabled}
        onClick={only.onClick}
        className={only.danger ? "text-danger [@media(hover:hover)]:hover:text-danger" : ""}
      >
        {only.label}
      </Button>
    );
  }
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
  const items: RowAction[] = [
    ...(!locked && transitional(d.status)
      ? [{ label: "Re-check now", onClick: onRecheck, disabled: pending.refreshing }]
      : []),
    ...(canWrite && serving ? [{ label: "Set root redirect", onClick: onEditRedirect }] : []),
    ...(canWrite ? [{ label: "Delete domain", onClick: onDelete, danger: true }] : []),
  ];

  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
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
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DomainStatusBadge domain={d} locked={locked} />
        {canWrite && serving && (
          <DefaultDomainButton
            domain={d}
            isDefault={isDefault}
            pending={pending.savingDefault}
            onToggle={onToggleDefault}
          />
        )}
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
}: {
  domain: DomainDTO;
  locked: boolean;
  graceEndsAt: number | null;
  appHost: string;
  orgId: string;
  onCopy: (text: string) => void;
}) {
  if (locked)
    return (
      <DetailLine className="tnum">
        {graceRunning(graceEndsAt)
          ? `Still redirecting until ${shortDate(graceEndsAt!)} (${graceLabel(graceEndsAt!)}), then it stops.`
          : "This domain has stopped redirecting. Upgrading brings it straight back, with no DNS to redo."}
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
            With no slug, it goes to{" "}
            <span className="font-mono [overflow-wrap:anywhere]">{d.rootRedirect}</span>
          </>
        ) : (
          "With no slug, it shows a not-found page"
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
      <DetailLine>Add this record at your DNS provider. We check every few seconds.</DetailLine>
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
