import { useState, useEffect, useRef } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  linkQuotaUsageQuery,
  useCurrentUser,
  useDomainMutations,
  useLinkHost,
  useLinkQuotaUsage,
} from "../lib/hooks";
import { canAdminOrg, preloadOrgDomains, useOrgLimits } from "../lib/org-limits";
import { settle, type PageContext } from "../lib/route-preload";
import { HrefLink } from "../lib/router-search";
import { Check, ChevronsUpDown } from "@/app/ui/icons";
import { Menu, MenuItem } from "../ui/menu";
import { buttonClass } from "../ui/button-class";
import { withErrorToast } from "../lib/mutation-toast";
import { useCurrentOrg } from "../lib/current-org";
import { api } from "../lib/api";
import type { OrgRole, UserOrg } from "@/shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { PageHeader } from "../ui/misc";
import { SettingsGroup, SettingsRow } from "../ui/settings-rows";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { copyToClipboard } from "../lib/clipboard";
import { QrDefaultsCard } from "../components/qr-defaults-card";
import { NoOrgState } from "../components/no-org";
import { OrganizationSkeleton } from "../components/skeletons";
import { orgNameSchema } from "../lib/schemas";
import posthog from "../lib/posthog";

type OrgNameForm = { name: string };

function isOrgOwner(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner";
}

/** The org-name field: syncs its default value when the current org
 * changes, and saves via PATCH. */
function useOrgRenameForm(org: UserOrg | null) {
  const qc = useQueryClient();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<OrgNameForm>({
    resolver: valibotResolver(orgNameSchema),
    defaultValues: { name: "" },
  });
  const resetOrgId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!org) {
      resetOrgId.current = undefined;
      return;
    }
    if (resetOrgId.current === org.id) return;
    resetOrgId.current = org.id;
    reset({ name: org.name });
  }, [org, reset]);

  const currentName = watch("name");

  const rename = handleSubmit(
    async (data) => {
      try {
        await api(`/orgs/${org?.id ?? ""}`, { method: "PATCH", body: { name: data.name } });
        await qc.invalidateQueries({ queryKey: ["user"] });
        posthog.capture("organization_renamed");
        toast("Organization renamed");
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    (errors) => toast(errors.name?.message ?? "Enter an organization name", "error"),
  );

  return { register, rename, currentName, isSubmitting, clearName: () => reset({ name: "" }) };
}

/** The delete-organization confirm dialog and its request. */
function useDeleteOrgFlow(orgId: string, clearNameField: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirmName("");
  };

  const deleteOrg = async () => {
    setPending(true);
    try {
      await api(`/orgs/${orgId}`, { method: "DELETE" });
      posthog.capture("organization_deleted");
      close();
      clearNameField();
      toast("Organization deleted");
      // useCurrentOrg falls back to the next org (or NoOrgState everywhere).
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPending(false);
    }
  };

  return { open, setOpen, close, confirmName, setConfirmName, pending, deleteOrg };
}

/**
 * Which domain new links start on (#69), chosen where the organization's
 * other settings live. Only domains that are serving are offered, the same
 * list the link editor reads, so the choice can never point at one that
 * resolves nowhere. Admins choose; everyone else reads it.
 */
function DefaultDomainRow({ orgId, canChange }: { orgId: string; canChange: boolean }) {
  const toast = useToast();
  const linkHost = useLinkHost();
  const { activeDomains, defaultDomainId, limits, canListDomains } = useOrgLimits();
  const { setDefault } = useDomainMutations(orgId);
  const options = [
    { id: "", host: linkHost, note: "shared" },
    ...activeDomains.map((d) => ({ id: d.id, host: d.hostname, note: "" })),
  ];
  const current = options.find((o) => o.id === (defaultDomainId ?? "")) ?? options[0];
  const choose = (id: string) => {
    if (id === (defaultDomainId ?? "")) return;
    const next = options.find((o) => o.id === id);
    setDefault.mutate(id || null, {
      onSuccess: () => {
        posthog.capture("domain_default_set", { cleared: !id });
        toast(`New links will use ${next?.host ?? linkHost}`);
      },
      onError: withErrorToast(toast),
    });
  };
  const face = (
    <>
      <span className="truncate font-mono text-[13px]">{current.host}</span>
      <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden />
    </>
  );
  return (
    <SettingsRow label="Default domain" hint="Where new links start. Each link can change it.">
      {canChange && activeDomains.length > 0 ? (
        <div className="w-full sm:w-80">
          <Menu
            label="Default domain"
            trigger={
              <span className="flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-surface px-3 smooth-shadow-ring-xs transition-[box-shadow] duration-150 [@media(hover:hover)]:hover:shadow-[0_0_0_1px_var(--accent)]">
                {face}
              </span>
            }
          >
            {options.map((o) => (
              <MenuItem key={o.id || "shared"} onClick={() => choose(o.id)}>
                <span className="w-4">
                  {o.id === current.id && <Check size={13} className="text-accent" />}
                </span>
                <span className="truncate font-mono text-[13px]">{o.host}</span>
                {o.note && <span className="ml-auto pl-3 text-xs text-muted">{o.note}</span>}
              </MenuItem>
            ))}
          </Menu>
        </div>
      ) : (
        <>
          <span className="font-mono text-[13px]">{current.host}</span>
          {canChange && canListDomains && limits.domains > 0 && (
            <HrefLink href="/domains" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Add a domain
            </HrefLink>
          )}
        </>
      )}
    </SettingsRow>
  );
}

function OrgRows({
  orgId,
  isOwner,
  canAdmin,
  register,
  rename,
  currentName,
  isSubmitting,
}: {
  orgId: string;
  isOwner: boolean;
  canAdmin: boolean;
  register: ReturnType<typeof useOrgRenameForm>["register"];
  rename: () => void;
  currentName: string | undefined;
  isSubmitting: boolean;
}) {
  const toast = useToast();
  return (
    <SettingsGroup>
      <SettingsRow label="Name" hint={isOwner ? undefined : "Only the owner can rename it."}>
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <Input
            {...register("name")}
            aria-label="Organization name"
            disabled={!isOwner}
            className="min-w-0 flex-1 sm:w-60 sm:flex-none"
          />
          {isOwner && (
            <Button type="submit" disabled={!currentName?.trim() || isSubmitting}>
              <BusyContent busy={isSubmitting}>Save</BusyContent>
            </Button>
          )}
        </form>
      </SettingsRow>
      <DefaultDomainRow orgId={orgId} canChange={canAdmin} />
      <SettingsRow label="Organization ID" hint="For the API.">
        <span className="font-mono text-[13px]">{orgId}</span>
        <CopyButton
          text={orgId}
          label="Copy organization ID"
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** "Its 199 links and 2 domains stop working at once." Counted when the
 * counts are in, and said without them until then. */
function deleteHint(links: number | undefined, domains: number): string {
  if (links === undefined) return "Its links and domains stop working at once.";
  const linkPart = links === 1 ? "1 link" : `${links.toLocaleString("en-US")} links`;
  if (domains === 0) return `Its ${linkPart} stop working at once.`;
  return `Its ${linkPart} and ${domains === 1 ? "1 domain" : `${domains} domains`} stop working at once.`;
}

function DeleteOrgGroup({ orgId, onDelete }: { orgId: string; onDelete: () => void }) {
  const links = useLinkQuotaUsage(orgId).data?.count;
  const domains = useOrgLimits().domains.data?.length ?? 0;
  return (
    <SettingsGroup danger>
      <SettingsRow label="Delete organization" hint={deleteHint(links, domains)}>
        <Button variant="danger" onClick={onDelete} aria-label="Delete organization">
          Delete
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

function DeleteOrgDialog({
  org,
  flow,
}: {
  org: UserOrg;
  flow: ReturnType<typeof useDeleteOrgFlow>;
}) {
  const toast = useToast();
  return (
    <ConfirmDialog
      title="Delete organization"
      open={flow.open}
      onClose={flow.close}
      onConfirm={flow.deleteOrg}
      confirmLabel="Delete organization"
      danger
      pending={flow.pending}
      confirmDisabled={flow.confirmName.trim() !== org.name}
    >
      <div>
        <p className="mb-4 text-sm">
          This permanently deletes <span className="font-bold text-accent">{org.name}</span>: every
          link, custom domain, and all click history. Short links stop working immediately. This
          cannot be undone.
        </p>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <span>To confirm, type</span>
            <code className="rounded bg-bg px-1.5 py-0.5 text-text">{org.name}</code>
            <CopyButton
              text={org.name}
              label="Copy organization name"
              onCopy={(text) => copyToClipboard(text, toast)}
            />
          </div>
          <Input
            value={flow.confirmName}
            onChange={(e) => flow.setConfirmName(e.target.value)}
            placeholder={org.name}
            aria-label={`Type ${org.name} to confirm deletion`}
            autoFocus
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}

/** Everything the organization page's first frame reads (see
 * lib/route-preload.ts): the default-domain choices, and for the owner the
 * counts the delete row quotes. */
export function preload(qc: QueryClient, orgId: string, { org, user }: PageContext) {
  return settle([
    preloadOrgDomains(qc, org, user),
    isOrgOwner(user.user.isAdmin, org.role)
      ? qc.ensureQueryData(linkQuotaUsageQuery(orgId))
      : undefined,
  ]);
}

export function OrganizationPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isOwner = isOrgOwner(!!currentUser.data?.user.isAdmin, org?.role);

  const { register, rename, currentName, isSubmitting, clearName } = useOrgRenameForm(org);
  const deleteOrgFlow = useDeleteOrgFlow(orgId, clearName);

  // Ownership is authoritative only after the fresh user response.
  if (currentUser.isLoading) return <OrganizationSkeleton />;
  if (!org) return <NoOrgState />;

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <PageHeader title="Organization" />
      <div className="flex max-w-[760px] flex-col gap-8">
        <OrgRows
          orgId={orgId}
          isOwner={isOwner}
          canAdmin={canAdminOrg(currentUser.data?.user.isAdmin, org.role, org.locked)}
          register={register}
          rename={rename}
          currentName={currentName}
          isSubmitting={isSubmitting}
        />
        <QrDefaultsCard key={org.id} />
        {isOwner && <DeleteOrgGroup orgId={orgId} onDelete={() => deleteOrgFlow.setOpen(true)} />}
      </div>

      <DeleteOrgDialog org={org} flow={deleteOrgFlow} />
    </div>
  );
}
