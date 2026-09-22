import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useCurrentOrg } from "../lib/current-org";
import { useSearchParams } from "../lib/router-search";
import {
  useApiKeys,
  useApiKeyMutations,
  useConnectedApps,
  useRevokeConnectedApp,
  type ConnectedApp,
} from "../lib/hooks";
import type { ApiKeyDTO } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Input } from "../ui/field";
import { Table, Th, Td, EmptyState, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";
import { relativeDate } from "../lib/dates";
import { Trash2 } from "../ui/icons";
import { cn } from "../ui/cn";
import { McpSetupCopyButton } from "../components/mcp-setup-prompt";
import { McpConnectWizard } from "../components/mcp-connect-wizard";
import { NoOrgState } from "../components/no-org";

/** The key value shown once, right after minting, with a copy button. */
function NewKeyBanner({ apiKey, onDismiss }: { apiKey: ApiKeyDTO; onDismiss: () => void }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-surface-2 p-4">
      <p className="text-sm">
        <strong>{apiKey.name}</strong> is ready. Copy the key now: it won't be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-2 font-mono text-xs">
          {apiKey.key}
        </code>
        <CopyButton
          text={apiKey.key ?? ""}
          label="Copy key"
          onCopy={(text) => copyToClipboard(text, toast)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <McpSetupCopyButton apiKey={apiKey.key} />
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ApiKeyRow({ apiKey, onRevoke }: { apiKey: ApiKeyDTO; onRevoke: () => void }) {
  return (
    <tr>
      <Td className="truncate">{apiKey.name}</Td>
      <Td className="font-mono text-xs text-muted">{apiKey.keyPrefix}…</Td>
      <Td className="text-xs text-muted">{relativeDate(apiKey.createdAt)}</Td>
      <Td className="text-xs text-muted">
        {apiKey.lastUsedAt ? relativeDate(apiKey.lastUsedAt) : "Never used"}
      </Td>
      <Td>
        <div className="flex justify-end">
          <IconButton label={`Revoke ${apiKey.name}`} danger onClick={onRevoke}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </Td>
    </tr>
  );
}

function ConnectedAppRow({ app, onRevoke }: { app: ConnectedApp; onRevoke: () => void }) {
  return (
    <tr>
      <Td className="truncate">{app.clientName}</Td>
      <Td className="text-xs text-muted">
        {app.scopes.filter((s) => s !== "openid" && s !== "offline_access").join(", ") || "—"}
      </Td>
      <Td className="text-xs text-muted">{relativeDate(app.createdAt)}</Td>
      <Td>
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
    <Table>
      <thead>
        <tr>
          <Th>App</Th>
          <Th>Access</Th>
          <Th>Connected</Th>
          <Th />
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
        confirmLabel="Disconnect"
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

/** The create-key form, name field plus button, and the just-minted banner
 * above it. Its own component so ApiKeysSection reads as sections wired
 * together, not one function holding the whole flow. */
function CreateKeyForm({
  name,
  onNameChange,
  onCreate,
  creating,
  justCreated,
  onDismissBanner,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  creating: boolean;
  justCreated: ApiKeyDTO | null;
  onDismissBanner: () => void;
}) {
  return (
    <>
      {justCreated && <NewKeyBanner apiKey={justCreated} onDismiss={onDismissBanner} />}
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Key name, e.g. Claude"
          className="min-w-0 flex-1"
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
        />
        <Button
          variant="primary"
          onClick={onCreate}
          disabled={!name.trim() || creating}
          className="shrink-0 whitespace-nowrap"
        >
          <BusyContent busy={creating}>Create key</BusyContent>
        </Button>
      </div>
    </>
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
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Prefix</Th>
          <Th>Created</Th>
          <Th>Last used</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <ApiKeyRow key={k.id} apiKey={k} onRevoke={() => onRevoke(k)} />
        ))}
      </tbody>
    </Table>
  );
}

/** State and mutations for the API keys section: create, revoke, and the
 * two pending-target bits of UI state that go with them. */
function useApiKeysSection(orgId: string) {
  const toast = useToast();
  const mutations = useApiKeyMutations(orgId);
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<ApiKeyDTO | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDTO | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await mutations.create.mutateAsync(trimmed);
      setJustCreated(created);
      setName("");
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
    name,
    setName,
    justCreated,
    setJustCreated,
    revokeTarget,
    setRevokeTarget,
    create,
    revoke,
    creating: mutations.create.isPending,
    revoking: mutations.revoke.isPending,
  };
}

function ApiKeysSection() {
  const { org } = useCurrentOrg();
  const isOwner = org?.role === "owner";
  const orgId = org?.id ?? "";
  const keys = useApiKeys(orgId, isOwner);
  const section = useApiKeysSection(orgId);

  if (!isOwner) {
    return (
      <p className="text-sm text-muted">
        Only this organization's owner can create or revoke API keys.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CreateKeyForm
        name={section.name}
        onNameChange={section.setName}
        onCreate={section.create}
        creating={section.creating}
        justCreated={section.justCreated}
        onDismissBanner={() => section.setJustCreated(null)}
      />

      <ApiKeysTable keys={keys.data} loading={keys.isLoading} onRevoke={section.setRevokeTarget} />

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

/** The tab param, read and written through the URL rather than local state,
 * so a shell reload lands back on whichever tab was open instead of always
 * resetting to "keys". "keys" has no ?tab= of its own (the default), so a
 * plain /api-keys link never needs one. */
function useApiTab(): [ApiTab, (tab: ApiTab) => void] {
  const [params, setParams] = useSearchParams();
  const tab: ApiTab = params.get("tab") === "mcp" ? "mcp" : "keys";
  const setTab = (next: ApiTab) => {
    const nextParams = new URLSearchParams(params);
    if (next === "keys") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };
  return [tab, setTab];
}

function ApiTabBar({ active, onChange }: { active: ApiTab; onChange: (tab: ApiTab) => void }) {
  return (
    <nav aria-label="API sections" className="mb-6 flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "border-b-2 px-3 py-2 text-sm transition-colors",
            active === tab.id
              ? "border-accent text-text"
              : "border-transparent text-muted hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

/** API (#131/#134/#139 follow-up): its own nav tab, not a card buried in
 * Settings. The MCP tab (OAuth connections) is per-user and open to every
 * member; the API keys tab stays owner-only, since minting a standing
 * credential is the same trust level as changing who has one (see
 * api-keys.ts). Both tabs render eagerly alongside the header and tab bar —
 * only their own content area shows a skeleton while its query loads,
 * matching every other page here, so switching or reloading on either tab
 * never blanks the chrome around it. */
export function ApiKeysPage() {
  const { org } = useCurrentOrg();
  const [tab, setTab] = useApiTab();

  if (!org) return <NoOrgState />;

  return (
    <div>
      <PageHeader title="API" sub="Connect an AI assistant, or call the API" />
      <ApiTabBar active={tab} onChange={setTab} />
      {tab === "mcp" ? <ConnectedAppsSection /> : <ApiKeysSection />}
    </div>
  );
}
