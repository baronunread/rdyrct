import { useState, type FormEvent, type ReactNode, useCallback } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link } from "react-router";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Trash2, RefreshCw } from "lucide-react";
import { useCurrentUser, useConfig, useDomains, useDomainMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, type DomainDTO, type OrgRole } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Input } from "../ui/field";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { withErrorToast } from "../lib/mutation-toast";
import { hostnameSchema } from "../lib/schemas";
import { Badge, Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { DomainsSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { CopyButton } from "../ui/copy-button";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";
import { copyToClipboard } from "../lib/clipboard";
import { addDomainMessage, recheckMessage } from "../lib/domain-messages";
import posthog from "../lib/posthog";

const domainStatusColor: Record<DomainDTO["status"], "accent" | "butter" | "mint" | "pink"> = {
  checking_dns: "butter",
  issuing_tls: "accent",
  active: "mint",
  error: "pink",
};

const domainStatusLabel: Record<DomainDTO["status"], string> = {
  checking_dns: "Checking DNS",
  issuing_tls: "Issuing TLS",
  active: "active",
  error: "Failed",
};

const transitional = (status: DomainDTO["status"]) =>
  status === "checking_dns" || status === "issuing_tls";

function canManageDomains(isPlatformAdmin: boolean, role: OrgRole): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

export function DomainsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();

  if (me.isLoading) return <DomainsSkeleton />;
  if (!org) return <NoOrgState />;

  const isAdmin = canManageDomains(!!me.data?.user.isAdmin, org.role);

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
        <p className="text-2xs tracking-wider text-muted uppercase">Custom domains</p>
        <p className="text-sm text-muted">
          Use your own domain for short links instead of the shared default. Custom domains are a
          paid feature.
        </p>
        <div>
          <Link to="/billing">
            <Button variant="primary">Upgrade to add a domain</Button>
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
        <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
          Add a domain
        </span>
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
        <span className="mt-1 block text-xs text-muted/80">
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
      <p className="text-2xs tracking-wider text-muted uppercase">How it works</p>
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

function DomainsCard({ orgId, plan }: { orgId: string; plan: "free" | "hobby" | "pro" }) {
  const domains = useDomains(orgId);
  const { add, refresh, setRootRedirect, remove } = useDomainMutations(orgId);
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

  if (limits.domains === 0) return <UpgradeDomainsCard />;

  return (
    <>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="w-full max-w-2xl">
          <div className="flex flex-col gap-4">
            <p className="text-2xs tracking-wider text-muted uppercase">Custom domains</p>

            {domains.isLoading ? (
              <DomainsSkeleton />
            ) : (
              <div className="flex flex-col gap-4">
                <MotionConfig reducedMotion="user">
                  <LazyMotion features={domAnimation}>
                    {domains.data?.map((d) => (
                      <DomainRow
                        key={d.id}
                        domain={d}
                        appHost={appHost}
                        refreshing={refresh.isPending}
                        savingRedirect={setRootRedirect.isPending}
                        redirectDraft={redirectDraft[d.id] ?? d.rootRedirect}
                        onRecheck={() => recheck(d)}
                        onDelete={() => setDeleting(d)}
                        onRedirectDraft={(v) => setRedirectDraft({ ...redirectDraft, [d.id]: v })}
                        onSaveRedirect={() => saveRedirect(d)}
                        onCopy={copy}
                      />
                    ))}
                  </LazyMotion>
                </MotionConfig>

                <AddDomainForm
                  hasDomains={!!domains.data?.length}
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
function DomainRow({
  domain: d,
  appHost,
  refreshing,
  savingRedirect,
  redirectDraft,
  onRecheck,
  onDelete,
  onRedirectDraft,
  onSaveRedirect,
  onCopy,
}: {
  domain: DomainDTO;
  appHost: string;
  refreshing: boolean;
  savingRedirect: boolean;
  redirectDraft: string;
  onRecheck: () => void;
  onDelete: () => void;
  onRedirectDraft: (v: string) => void;
  onSaveRedirect: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{d.hostname}</span>
        <div className="relative flex items-center gap-1">
          <DomainStatusBadge domain={d} refreshing={refreshing} onRecheck={onRecheck} />
          <IconButton label={`Delete ${d.hostname}`} danger onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <DomainStatusDetail
        domain={d}
        appHost={appHost}
        redirectDraft={redirectDraft}
        savingRedirect={savingRedirect}
        onRedirectDraft={onRedirectDraft}
        onSaveRedirect={onSaveRedirect}
        onCopy={onCopy}
      />
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
      <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
        Root redirect
      </span>
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
      <span className="mt-1 block text-xs text-muted/80">
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
