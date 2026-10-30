import { useEffect, useRef, useState } from "react";
import { TabUnderline } from "../ui/tab-underline";
import { errorMessage } from "@/app/lib/error-message";
import { useCurrentOrg } from "../lib/current-org";
import { useSearchParams } from "../lib/router-search";
import type { QueryClient } from "@tanstack/react-query";
import { settle, type PageContext } from "../lib/route-preload";
import {
  apiKeysQuery,
  connectedAppsQuery,
  useApiKeys,
  useApiKeyMutations,
  useConnectedApps,
  useCurrentUser,
  useRevokeConnectedApp,
  type ConnectedApp,
} from "../lib/hooks";
import type { ApiKeyDTO } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Table, Th, Td, EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { relativeDate, shortDate } from "../lib/dates";
import { ExternalLink, Plus, Trash2 } from "../ui/icons";
import { RDYRCT_SITE } from "@/shared/site";
import { cn } from "../ui/cn";
import { McpConnectWizard } from "../components/mcp-connect-wizard";
import { CreateApiKeyDialog } from "../components/create-api-key-dialog";
import { NoOrgState } from "../components/no-org";
import { ApiKeysSkeleton } from "../components/skeletons";
import { StableLabel } from "../ui/stable-label";

function ConnectedAppRow({ app, onRevoke }: { app: ConnectedApp; onRevoke: () => void }) {
  return (
    <tr>
      <Td className="truncate text-sm font-semibold">{app.clientName}</Td>
      <Td className="tnum text-sm whitespace-nowrap text-muted">{relativeDate(app.createdAt)}</Td>
      <Td className="py-1.5">
        <div className="flex justify-end">
          <IconButton label={`Revoke ${app.clientName}`} danger onClick={onRevoke}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </Td>
    </tr>
  );
}

/** Connected apps: OAuth grants (#139 follow-up), the recommended way to
 * connect an MCP client now — a real consent screen, no key to copy or
 * lose. Per-user, not per-org: unlike API keys below, any member sees and
 * revokes their own connections, since authorizing one is a session action
 * (a browser consent screen), not minting a standing credential. */
// Loading and empty are both handled a level up, by ConnectedAppsSection's
// wizard gate: the empty case shows the connect guide instead of a plain
// "no apps yet" line, so this only ever renders once `apps` is non-empty.
function ConnectedAppsTable({
  apps,
  onRevoke,
}: {
  apps: ConnectedApp[];
  onRevoke: (app: ConnectedApp) => void;
}) {
  return (
    <Table fixed>
      <thead>
        <tr>
          <Th>App</Th>
          <Th className="w-32 sm:w-40">Connected</Th>
          <Th className="w-14">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {apps.map((app) => (
          <ConnectedAppRow key={app.id} app={app} onRevoke={() => onRevoke(app)} />
        ))}
      </tbody>
    </Table>
  );
}

/** Drives the connect wizard's two states (the guide, and waiting for the
 * first grant to appear) on top of the same useConnectedApps() query the
 * table below reads — there's no webhook for "finished the OAuth flow in
 * your AI tool", so a new id showing up in this list, polled while waiting,
 * is the only signal there is. */
function useConnectWizard() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const apps = useConnectedApps(waiting);

  useEffect(() => {
    if (!waiting) return;
    const fresh = apps.data?.find((app) => !knownIds.current.has(app.id));
    if (!fresh) return;
    toast(`${fresh.clientName} connected`);
    setWaiting(false);
    setGuideOpen(false);
  }, [waiting, apps.data, toast]);

  return {
    apps,
    waiting,
    showWizard: !apps.isLoading && (waiting || guideOpen || apps.data?.length === 0),
    startWaiting: () => {
      knownIds.current = new Set((apps.data ?? []).map((app) => app.id));
      setWaiting(true);
    },
    cancelWaiting: () => setWaiting(false),
    openGuide: () => setGuideOpen(true),
  };
}

function ConnectedAppsSection() {
  const toast = useToast();
  const { apps, waiting, showWizard, startWaiting, cancelWaiting, openGuide } = useConnectWizard();
  const revokeApp = useRevokeConnectedApp();
  const [revokeTarget, setRevokeTarget] = useState<ConnectedApp | null>(null);

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeApp.mutateAsync(revokeTarget.id);
      toast("Disconnected");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRevokeTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {apps.isLoading ? (
        <TableSkeleton rows={3} testId="connected-apps-rows-skeleton" />
      ) : showWizard ? (
        <McpConnectWizard
          waiting={waiting}
          onStartWaiting={startWaiting}
          onCancelWaiting={cancelWaiting}
        />
      ) : (
        <>
          <ConnectedAppsTable apps={apps.data ?? []} onRevoke={setRevokeTarget} />
          <div>
            <Button variant="outline" size="sm" onClick={openGuide}>
              Connect another app
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        title="Disconnect app"
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={revoke}
        confirmLabel="Disconnect app"
        danger
        pending={revokeApp.isPending}
      >
        <p className="text-sm">
          <strong>{revokeTarget?.clientName}</strong> can't get a new token after this. Anything it
          already has keeps working for up to an hour, until that token expires.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * A key as the API may send it: who made it, once the worker says so. Keys
 * belong to the account that made them (session.ts), so until the API sends
 * a name there is nobody to name but the reader.
 */
type ApiKeyRowData = ApiKeyDTO & { createdByName?: string | null };

/** "Oct 2, 2026 by Franco", or just the date until the API names the maker. */
function createdLabel(key: ApiKeyRowData): string {
  const date = shortDate(key.createdAt);
  const first = key.createdByName?.trim().split(/\s+/)[0];
  return first ? `${date} by ${first}` : date;
}

/** One key: its name, its prefix in mono, when and by whom it was made, and
 * when it last called. The trash shows on hover where there is hover. */
function ApiKeyRow({ apiKey, onRevoke }: { apiKey: ApiKeyRowData; onRevoke: () => void }) {
  return (
    <tr className="group/row">
      <Td className="truncate text-sm font-semibold" title={apiKey.name}>
        {apiKey.name}
      </Td>
      <Td className="hidden truncate font-mono text-xs text-muted sm:table-cell">
        {apiKey.keyPrefix}…
      </Td>
      <Td className="tnum hidden text-sm whitespace-nowrap text-muted md:table-cell">
        {createdLabel(apiKey)}
      </Td>
      <Td
        className={cn(
          "tnum text-sm whitespace-nowrap",
          apiKey.lastUsedAt ? "text-muted" : "text-placeholder",
        )}
      >
        {apiKey.lastUsedAt ? relativeDate(apiKey.lastUsedAt) : "Never"}
      </Td>
      <Td className="py-1.5">
        <div className="flex justify-end transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
          <IconButton label={`Revoke ${apiKey.name}`} danger onClick={onRevoke}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </Td>
    </tr>
  );
}

function ApiKeysTable({
  keys,
  loading,
  onRevoke,
}: {
  keys: ApiKeyDTO[] | undefined;
  loading: boolean;
  onRevoke: (key: ApiKeyDTO) => void;
}) {
  if (loading) return <TableSkeleton rows={3} testId="api-keys-rows-skeleton" />;
  if (!keys || keys.length === 0)
    return (
      <EmptyState
        title="No API keys yet"
        hint="Create one to call the API or connect an MCP client."
      />
    );
  return (
    <>
      <Table fixed>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th className="hidden sm:table-cell sm:w-56">Key</Th>
            <Th className="hidden md:table-cell md:w-52">Created</Th>
            <Th className="w-32">Last used</Th>
            <Th className="w-14">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onRevoke={() => onRevoke(k)} />
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-pretty text-muted">
        A key acts as you, in every organization you own or belong to. You see the full key once,
        when you create it.
      </p>
    </>
  );
}

/** State and mutations for the API keys tab: the create dialog, the key
 * shown once after it, and the revoke confirmation. */
function useApiKeysSection(orgId: string) {
  const toast = useToast();
  const mutations = useApiKeyMutations(orgId);
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<ApiKeyDTO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDTO | null>(null);

  const create = async (name: string) => {
    try {
      setJustCreated(await mutations.create.mutateAsync(name));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await mutations.revoke.mutateAsync(revokeTarget.id);
      toast("Key revoked");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRevokeTarget(null);
    }
  };

  return {
    createOpen,
    // The shown-once key is cleared on the next open, not on close, so the
    // dialog does not swap back to the form while it animates out.
    openCreate: () => {
      setJustCreated(null);
      setCreateOpen(true);
    },
    setCreateOpen,
    justCreated,
    revokeTarget,
    setRevokeTarget,
    create,
    revoke,
    creating: mutations.create.isPending,
    revoking: mutations.revoke.isPending,
  };
}

type ApiKeysState = ReturnType<typeof useApiKeysSection>;

function ApiKeysSection({ orgId, section }: { orgId: string; section: ApiKeysState }) {
  const keys = useApiKeys(orgId, true);
  return (
    <div className="flex flex-col gap-3">
      <ApiKeysTable keys={keys.data} loading={keys.isLoading} onRevoke={section.setRevokeTarget} />

      <CreateApiKeyDialog
        open={section.createOpen}
        onOpenChange={section.setCreateOpen}
        justCreated={section.justCreated}
        onCreate={(name) => void section.create(name)}
        creating={section.creating}
      />

      <ConfirmDialog
        title="Revoke API key"
        open={!!section.revokeTarget}
        onClose={() => section.setRevokeTarget(null)}
        onConfirm={section.revoke}
        confirmLabel="Revoke key"
        danger
        pending={section.revoking}
      >
        <p className="text-sm">
          Anything using <strong>{section.revokeTarget?.name}</strong> stops working immediately.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** API (#131/#134/#139 follow-up): its own nav tab, not a card buried
 * in Settings. OAuth connections are per-user and open to every member; API
 * keys stay owner-only, since minting a standing credential is the same
 * trust level as changing who has one (see api-keys.ts). */
type ApiTab = "keys" | "mcp";
const TABS: { id: ApiTab; label: string }[] = [
  { id: "keys", label: "API keys" },
  { id: "mcp", label: "MCP" },
];

/** The API reference. rdyrct.com serves it at /docs; a self-hosted copy has
 * no marketing pages, so it points at rdyrct.com's. */
const DOCS_URL = RDYRCT_SITE ? "/docs" : "https://rdyrct.com/docs";

/** The tab param, read and written through the URL rather than local state,
 * so a shell reload lands back on whichever tab was open instead of always
 * resetting to "keys". "keys" has no ?tab= of its own (the default), so a
 * plain /api-keys link never needs one. */
const tabFrom = (params: URLSearchParams): ApiTab => (params.get("tab") === "mcp" ? "mcp" : "keys");

function useApiTab(): [ApiTab, (tab: ApiTab) => void] {
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params);
  const setTab = (next: ApiTab) => {
    const nextParams = new URLSearchParams(params);
    if (next === "keys") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };
  return [tab, setTab];
}

/** Underline tabs, as in the panels (rdyrct-design, "Panels hold lists
 * behind tabs"). Plain buttons rather than PanelTabs: the tab lives in the
 * URL, so a reload lands back on it. */
function ApiTabBar({ active, onChange }: { active: ApiTab; onChange: (tab: ApiTab) => void }) {
  const bar = useRef<HTMLElement>(null);
  return (
    <nav
      ref={bar}
      aria-label="API sections"
      className="relative mb-5 flex gap-4 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={active === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
          className={cn(
            "cursor-pointer pb-2.5 text-sm whitespace-nowrap outline-none focus-visible:text-text focus-visible:underline",
            active === tab.id
              ? "font-semibold text-text"
              : "text-muted [@media(hover:hover)]:hover:text-text",
          )}
        >
          <StableLabel>{tab.label}</StableLabel>
        </button>
      ))}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex cursor-pointer items-center gap-1 pb-2.5 text-sm whitespace-nowrap text-muted outline-none focus-visible:text-text focus-visible:underline [@media(hover:hover)]:hover:text-text"
      >
        Docs
        <ExternalLink size={13} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <TabUnderline bar={bar} />
    </nav>
  );
}

function OwnerOnlyNotice() {
  return (
    <p className="text-sm text-muted">
      Only this organization's owner can create or revoke API keys.
    </p>
  );
}

/** Header, tabs and the open tab. "Create key" is the screen's one primary
 * button, and only on the keys tab, for the owner. */
function ApiView({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const [tab, setTab] = useApiTab();
  const section = useApiKeysSection(orgId);
  const showNewKey = tab === "keys" && isOwner;

  return (
    <div>
      <PageHeader
        title="API"
        sub="Call the API or connect an AI assistant."
        action={
          showNewKey ? (
            <Button variant="primary" onClick={section.openCreate}>
              <Plus size={15} aria-hidden /> Create key
            </Button>
          ) : undefined
        }
      />
      <ApiTabBar active={tab} onChange={setTab} />
      {tab === "mcp" ? (
        <ConnectedAppsSection />
      ) : isOwner ? (
        <ApiKeysSection orgId={orgId} section={section} />
      ) : (
        <OwnerOnlyNotice />
      )}
    </div>
  );
}

/** API (#131/#134/#139 follow-up): its own nav tab, not a card buried in
 * Settings. The MCP tab (OAuth connections) is per-user and open to every
 * member; the API keys tab stays owner-only, since minting a standing
 * credential is the same trust level as changing who has one (see
 * api-keys.ts). Both tabs render eagerly alongside the header and tab bar:
 * only their own content area shows a skeleton while its query loads,
 * matching every other page here, so switching or reloading on either tab
 * never blanks the chrome around it. */
/** Everything the API page's first frame reads (see lib/route-preload.ts):
 * the open tab's list. */
export function preload(qc: QueryClient, orgId: string, { org, searchStr }: PageContext) {
  if (tabFrom(new URLSearchParams(searchStr)) === "mcp")
    return settle([qc.ensureQueryData(connectedAppsQuery())]);
  return org.role === "owner"
    ? settle([qc.ensureQueryData(apiKeysQuery(orgId))])
    : Promise.resolve();
}

export function ApiKeysPage() {
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();

  // The cached shell may know the organization before /user confirms the
  // current role and plan. Do not briefly offer a stale create control.
  if (currentUser.isLoading) return <ApiKeysSkeleton />;
  if (!org) return <NoOrgState />;
  return <ApiView orgId={org.id} isOwner={org.role === "owner"} />;
}
