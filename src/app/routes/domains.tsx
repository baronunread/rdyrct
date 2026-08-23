import { useState, type FormEvent, type ReactNode, useCallback } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Trash2, RefreshCw, Star } from "lucide-react";
import { useCurrentUser, useConfig, useDomains, useDomainMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, type DomainDTO, type OrgRole, type UserOrg } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { Input } from "../ui/field";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { withErrorToast } from "../lib/mutation-toast";
import { hostnameSchema } from "../lib/schemas";
import { Badge, Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { DomainsPageSkeleton, DomainsSkeleton, HeaderSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { LockedPanel } from "../components/over-limit";
import { graceLabel } from "../lib/grace";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";
import { copyToClipboard } from "../lib/clipboard";
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
  // an upgrade card, so drawing a form and a domain list for either promises
  // controls that the page then takes away. Role and plan are both already in
  // hand: the only thing still loading is whether this is a platform admin,
  // and that is a handful of people.
  if (currentUser.isLoading)
    return org && canManageDomains(false, org.role) && PLAN_LIMITS[org.plan].domains > 0 ? (
      <DomainsPageSkeleton />
    ) : (
      <HeaderSkeleton />
    );
  if (!org) return <NoOrgState />;

  const isAdmin = canManageDomains(!!currentUser.data?.user.isAdmin, org.role);

  return (
    <div>
      <PageHeader title="Domains" sub="Serve short links from your own domain" />
      {!isAdmin ? (
        <p className="text-sm text-muted">You don't have access to domains.</p>
      ) : (
        <DomainsCard orgId={orgId} plan={org.plan} />
      )}
    </div>
  );
}

function UpgradeDomainsCard() {
  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-muted">Custom domains</p>
        <p className="text-sm text-muted">
          Use your own domain for short links instead of the shared default. Custom domains are a
          paid feature.
        </p>
        <div>
          <Link to="/billing" className={buttonClass({ variant: "primary" })}>
            Upgrade to add a domain
          </Link>
        </div>
      </div>
    </Card>
  );
}

function AddDomainForm({
  hasDomains,
  register,
  onSubmit,
  pending,
}: {
  hasDomains: boolean;
  register: UseFormRegister<{ hostname: string }>;
  onSubmit: (e: FormEvent) => void;
  pending: boolean;
}) {
  return (
    <form
      className={cn("flex flex-col gap-3", hasDomains ? "border-t border-border pt-4" : "")}
      onSubmit={onSubmit}
    >
      <div>
        <span className="mb-1.5 block text-xs text-muted">Add a domain</span>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              {...register("hostname")}
              placeholder="links.example.com"
              aria-label="Add a domain"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={pending} className="w-24">
            <BusyContent busy={pending}>Add domain</BusyContent>
          </Button>
        </div>
        <span className="mt-1 block text-xs text-muted">
          After adding, we check for the CNAME record every few seconds. Once detected, we issue a
          TLS certificate automatically. You can also hit the refresh button to check progress.
        </span>
      </div>
    </form>
  );
}

function HowItWorksSteps({ appHost }: { appHost: string }) {
  return (
    <aside className="w-full shrink-0 lg:w-72">
      <p className="text-xs font-medium text-muted">How it works</p>
      <ol className="mt-3 flex flex-col gap-3">
        <Step n={1}>
          At your DNS provider, create a CNAME record pointing a hostname you own (e.g.{" "}
          <code className="text-text">links.example.com</code>) at{" "}
          <code className="text-text">{appHost}</code>.
        </Step>
        <Step n={2}>Add the hostname below. We detect the CNAME and issue TLS automatically.</Step>
        <Step n={3}>
          Your short links go live under your brand. Certificates and renewals are handled for you.
        </Step>
      </ol>
    </aside>
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
      confirmLabel="Delete"
      danger
      pending={pending}
    >
      Delete <span className="font-bold">{deleting?.hostname}</span>? Links still using this domain
      must be moved or deleted first.
    </ConfirmDialog>
  );
}

/**
 * Every write the domains card can make, with its toast and its analytics
 * event. Split out of DomainsCard so that component is about what the page
 * shows and this is about what its buttons do.
 */
function useDomainActions({
  mutations: { add, refresh, setRootRedirect, remove, setDefault },
  org,
  toast,
  reset,
  deleting,
  setDeleting,
  redirectDraft,
}: {
  mutations: ReturnType<typeof useDomainMutations>;
  org: UserOrg | null;
  toast: ReturnType<typeof useToast>;
  reset: () => void;
  deleting: DomainDTO | null;
  setDeleting: (d: DomainDTO | null) => void;
  redirectDraft: Record<string, string>;
}) {
  const copy = (text: string) => copyToClipboard(text, toast);

  const addDomain = useCallback(
    ({ hostname }: { hostname: string }) => {
      add.mutate(hostname, {
        onSuccess: (d) => {
          posthog.capture("domain_added", { initial_status: d.status });
          reset();
          toast(addDomainMessage(d.status));
        },
        onError: withErrorToast(toast),
      });
    },
    [add, reset, toast],
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

  const saveRedirect = (domain: DomainDTO) => {
    const value = redirectDraft[domain.id] ?? domain.rootRedirect;
    setRootRedirect.mutate(
      { id: domain.id, rootRedirect: value },
      {
        onSuccess: () => {
          posthog.capture("domain_root_redirect_updated");
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

function DomainsCard({ orgId, plan }: { orgId: string; plan: "free" | "hobby" | "pro" }) {
  const domains = useDomains(orgId);
  const { add, refresh, setRootRedirect, remove, setDefault } = useDomainMutations(orgId);
  const { org } = useCurrentOrg();
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
  const toast = useToast();
  const limits = PLAN_LIMITS[plan];
  const [deleting, setDeleting] = useState<DomainDTO | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<Record<string, string>>({});
  const { register, handleSubmit, reset } = useForm<{ hostname: string }>({
    resolver: valibotResolver(hostnameSchema),
    defaultValues: { hostname: "" },
  });

  const { copy, addDomain, recheck, saveRedirect, toggleDefault, confirmDelete } = useDomainActions(
    {
      mutations: { add, refresh, setRootRedirect, remove, setDefault },
      org,
      toast,
      reset,
      deleting,
      setDeleting,
      redirectDraft,
    },
  );

  // A plan with no domains still lists the ones the org already has (#159).
  // Hiding them was the bug: an owner who downgrades and finds an upgrade
  // pitch where their domains used to be concludes we deleted them.
  const hasDomains = !!domains.data?.length;
  if (limits.domains === 0 && !hasDomains) return <UpgradeDomainsCard />;

  return (
    <>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="w-full max-w-2xl">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-medium text-muted">Custom domains</p>

            {domains.isLoading ? (
              <DomainsSkeleton />
            ) : (
              <div className="flex flex-col gap-4">
                <DomainList
                  domains={domains.data}
                  org={org}
                  appHost={appHost}
                  pending={{
                    refreshing: refresh.isPending,
                    savingRedirect: setRootRedirect.isPending,
                    savingDefault: setDefault.isPending,
                  }}
                  redirectDraft={redirectDraft}
                  onToggleDefault={toggleDefault}
                  onRecheck={recheck}
                  onDelete={setDeleting}
                  onRedirectDraft={(id, v) => setRedirectDraft({ ...redirectDraft, [id]: v })}
                  onSaveRedirect={saveRedirect}
                  onCopy={copy}
                />

                <DomainsFooter
                  canAdd={limits.domains > 0}
                  hasDomains={hasDomains}
                  graceEndsAt={org?.graceEndsAt ?? null}
                  register={register}
                  onSubmit={handleSubmit(addDomain, (errors) =>
                    toast(errors.hostname?.message ?? "Enter a valid hostname", "error"),
                  )}
                  pending={add.isPending}
                />
              </div>
            )}
          </div>
        </Card>

        <HowItWorksSteps appHost={appHost} />
      </div>

      <DeleteDomainDialog
        deleting={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </>
  );
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

function RecheckButton({ refreshing, onRecheck }: { refreshing: boolean; onRecheck: () => void }) {
  return (
    <IconButton label="Re-check now" disabled={refreshing} onClick={onRecheck}>
      <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
    </IconButton>
  );
}

function DomainStatusBadge({
  domain: d,
  refreshing,
  onRecheck,
}: {
  domain: DomainDTO;
  refreshing: boolean;
  onRecheck: () => void;
}) {
  const { initial, exit, duration } = statusSlideVariants(document.visibilityState === "visible");
  return (
    <>
      <AnimatePresence mode="popLayout">
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
      {transitional(d.status) && <RecheckButton refreshing={refreshing} onRecheck={onRecheck} />}
    </>
  );
}

/** One connected domain: status badge (animated on change), DNS/TLS guidance
 * while it's transitional, and the root-redirect editor once it's active. */
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
  if (d.status !== "active") return null;
  return (
    <IconButton
      label={isDefault ? `Stop defaulting to ${d.hostname}` : `Default new links to ${d.hostname}`}
      disabled={pending}
      onClick={onToggle}
    >
      <Star size={14} className={isDefault ? "fill-accent text-accent" : ""} />
    </IconButton>
  );
}

/**
 * What sits under the list: the form on a plan that may add a domain, and
 * the explanation on one that may not (#159).
 *
 * Exactly one of the two, always. A plan with no domains that still holds
 * some needs the second, which is what makes the read-only list make sense
 * rather than look like a bug.
 */
function DomainsFooter({
  canAdd,
  hasDomains,
  graceEndsAt,
  register,
  onSubmit,
  pending,
}: {
  canAdd: boolean;
  hasDomains: boolean;
  graceEndsAt: number | null;
  register: UseFormRegister<{ hostname: string }>;
  onSubmit: (e: FormEvent) => void;
  pending: boolean;
}) {
  if (!canAdd)
    return (
      <LockedPanel
        title="Your custom domains are locked"
        reason="Custom domains need Hobby or Pro. Nothing was deleted: the DNS record, the certificate and every link on these domains are still here."
        until={graceEndsAt}
        cta="Upgrade to keep them"
      />
    );
  return (
    <AddDomainForm
      hasDomains={hasDomains}
      register={register}
      onSubmit={onSubmit}
      pending={pending}
    />
  );
}

/** Every connected domain, in one animated list. Split out of DomainsCard so
 * that component is about the page's state and this one is about its rows. */
function DomainList({
  domains,
  org,
  appHost,
  pending,
  redirectDraft,
  onToggleDefault,
  onRecheck,
  onDelete,
  onRedirectDraft,
  onSaveRedirect,
  onCopy,
}: {
  domains: DomainDTO[] | undefined;
  org: UserOrg | null;
  appHost: string;
  pending: { refreshing: boolean; savingRedirect: boolean; savingDefault: boolean };
  redirectDraft: Record<string, string>;
  onToggleDefault: (d: DomainDTO) => void;
  onRecheck: (d: DomainDTO) => void;
  onDelete: (d: DomainDTO) => void;
  onRedirectDraft: (id: string, value: string) => void;
  onSaveRedirect: (d: DomainDTO) => void;
  onCopy: (text: string) => void;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        {(domains ?? []).map((d) => (
          <DomainRow
            key={d.id}
            domain={d}
            appHost={appHost}
            refreshing={pending.refreshing}
            savingRedirect={pending.savingRedirect}
            isDefault={org?.defaultDomainId === d.id}
            savingDefault={pending.savingDefault}
            onToggleDefault={() => onToggleDefault(d)}
            redirectDraft={redirectDraft[d.id] ?? d.rootRedirect}
            onRecheck={() => onRecheck(d)}
            onDelete={() => onDelete(d)}
            onRedirectDraft={(v) => onRedirectDraft(d.id, v)}
            onSaveRedirect={() => onSaveRedirect(d)}
            onCopy={onCopy}
            graceEndsAt={org?.graceEndsAt ?? null}
          />
        ))}
      </LazyMotion>
    </MotionConfig>
  );
}

function DomainRow({
  domain: d,
  appHost,
  refreshing,
  savingRedirect,
  isDefault,
  savingDefault,
  redirectDraft,
  onRecheck,
  onToggleDefault,
  onDelete,
  onRedirectDraft,
  onSaveRedirect,
  onCopy,
  graceEndsAt,
}: {
  domain: DomainDTO;
  appHost: string;
  refreshing: boolean;
  savingRedirect: boolean;
  isDefault: boolean;
  savingDefault: boolean;
  redirectDraft: string;
  onRecheck: () => void;
  onToggleDefault: () => void;
  onDelete: () => void;
  onRedirectDraft: (v: string) => void;
  onSaveRedirect: () => void;
  onCopy: (text: string) => void;
  /** When the org's grace period ends, for a locked domain's countdown. */
  graceEndsAt: number | null;
}) {
  const locked = d.lockedAt !== null;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{d.hostname}</span>
        <div className="relative flex items-center gap-1">
          {isDefault && !locked && <Badge color="mint">default</Badge>}
          {locked ? (
            <Badge color="butter">locked</Badge>
          ) : (
            <>
              <DomainStatusBadge domain={d} refreshing={refreshing} onRecheck={onRecheck} />
              <DefaultDomainButton
                domain={d}
                isDefault={isDefault}
                pending={savingDefault}
                onToggle={onToggleDefault}
              />
            </>
          )}
          <IconButton label={`Delete ${d.hostname}`} danger onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      {locked ? (
        <p className="tnum mt-2 text-xs text-muted">
          {graceEndsAt !== null
            ? `Still redirecting until ${new Date(graceEndsAt).toLocaleDateString()} (${graceLabel(graceEndsAt)}), then it stops.`
            : "This domain has stopped redirecting."}
        </p>
      ) : (
        <DomainStatusDetail
          domain={d}
          appHost={appHost}
          redirectDraft={redirectDraft}
          savingRedirect={savingRedirect}
          onRedirectDraft={onRedirectDraft}
          onSaveRedirect={onSaveRedirect}
          onCopy={onCopy}
        />
      )}
    </div>
  );
}

function TransitionalDomainDetail({
  domain: d,
  appHost,
  onCopy,
}: {
  domain: DomainDTO;
  appHost: string;
  onCopy: (text: string) => void;
}) {
  const checkingDns = d.status === "checking_dns";
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-md bg-surface-2/50 p-3 text-xs text-muted">
      <p>
        {checkingDns
          ? "To activate, create this record at your DNS provider:"
          : "DNS resolved. Waiting for the TLS certificate to be issued."}
      </p>
      {checkingDns && (
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-bg px-1.5 py-0.5 text-text">
            {d.hostname} CNAME {appHost}
          </code>
          <CopyButton text={appHost} label="Copy CNAME target" onCopy={onCopy} />
        </div>
      )}
      <p>
        {checkingDns
          ? "We re-check automatically every few seconds. "
          : "This usually takes a few minutes. "}
        Hit the refresh button above to check progress manually.
      </p>
    </div>
  );
}

function ErrorDomainDetail({ domain: d }: { domain: DomainDTO }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-md bg-danger/10 p-3 text-xs text-danger">
      <p>{d.statusReason || "Activation failed. Delete and re-add the domain to try again."}</p>
    </div>
  );
}

function RootRedirectEditor({
  redirectDraft,
  savingRedirect,
  onRedirectDraft,
  onSaveRedirect,
}: {
  redirectDraft: string;
  savingRedirect: boolean;
  onRedirectDraft: (v: string) => void;
  onSaveRedirect: () => void;
}) {
  return (
    <div className="mt-3">
      <span className="mb-1.5 block text-xs text-muted">Root redirect</span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Root redirect"
            value={redirectDraft}
            onChange={(e) => onRedirectDraft(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <Button size="sm" disabled={savingRedirect} onClick={onSaveRedirect}>
          Save
        </Button>
      </div>
      <span className="mt-1 block text-xs text-muted">
        Where the bare domain (no slug) sends visitors, e.g. your homepage
      </span>
    </div>
  );
}

/** The section below a domain's status badge: DNS/TLS guidance while
 * transitional, the failure reason on error, or the root-redirect editor
 * once active. Exactly one of these renders per domain. */
function DomainStatusDetail({
  domain: d,
  appHost,
  redirectDraft,
  savingRedirect,
  onRedirectDraft,
  onSaveRedirect,
  onCopy,
}: {
  domain: DomainDTO;
  appHost: string;
  redirectDraft: string;
  savingRedirect: boolean;
  onRedirectDraft: (v: string) => void;
  onSaveRedirect: () => void;
  onCopy: (text: string) => void;
}) {
  if (transitional(d.status))
    return <TransitionalDomainDetail domain={d} appHost={appHost} onCopy={onCopy} />;
  if (d.status === "error") return <ErrorDomainDetail domain={d} />;
  return (
    <RootRedirectEditor
      redirectDraft={redirectDraft}
      savingRedirect={savingRedirect}
      onRedirectDraft={onRedirectDraft}
      onSaveRedirect={onSaveRedirect}
    />
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-xs text-muted">
      <span className="tnum font-bold text-accent">{n}</span>
      <span>{children}</span>
    </li>
  );
}
