import { useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useCurrentOrg } from "../lib/current-org";
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
import { BusyContent, Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { copyToClipboard } from "../lib/clipboard";
import { relativeDate } from "../lib/dates";
import { Trash2 } from "../ui/icons";
import { McpSetupCopyButton } from "../components/mcp-setup-prompt";
import { NoOrgState } from "../components/no-org";
import { ApiKeysSkeleton } from "../components/skeletons";

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
function ConnectedAppsTable({
  apps,
  loading,
  onRevoke,
}: {
  apps: ConnectedApp[] | undefined;
  loading: boolean;
  onRevoke: (app: ConnectedApp) => void;
}) {
  if (loading) return <Spinner />;
  if (!apps || apps.length === 0)
    return (
      <EmptyState
        title="No connected apps yet"
        hint="Add rdyrct as an MCP connector in an AI assistant to see it here."
      />
    );
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

function ConnectedAppsSection() {
  const toast = useToast();
  const apps = useConnectedApps();
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
      <div>
        <h2 className="font-bold">Connected apps</h2>
        <p className="text-sm text-muted">
          AI assistants and other apps you've connected via OAuth. This is the recommended way to
          connect an MCP client.
        </p>
      </div>

      <ConnectedAppsTable apps={apps.data} loading={apps.isLoading} onRevoke={setRevokeTarget} />

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
  if (loading) return <Spinner />;
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
      <div>
        <h2 className="font-bold">API keys</h2>
        <p className="mt-1 text-sm text-muted">
          Only this organization's owner can create or revoke API keys.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-bold">API keys</h2>
        <p className="text-sm text-muted">
          Call the REST API directly, or connect an MCP client that doesn't support OAuth yet.
        </p>
      </div>

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

/** API & MCP (#131/#134/#139 follow-up): its own nav tab, not a card buried
 * in Settings. OAuth connections are per-user and open to every member; API
 * keys stay owner-only, since minting a standing credential is the same
 * trust level as changing who has one (see api-keys.ts). */
export function ApiKeysPage() {
  const { org } = useCurrentOrg();
  const isOwner = org?.role === "owner";
  const orgId = org?.id ?? "";
  const keys = useApiKeys(orgId, isOwner);

  if (!org) return <NoOrgState />;
  if (keys.isLoading && isOwner) return <ApiKeysSkeleton />;

  return (
    <div>
      <PageHeader
        title="API & MCP"
        sub="Connect an AI assistant, or call the API"
        action={<McpSetupCopyButton />}
      />
      <div className="flex flex-col gap-8">
        <ConnectedAppsSection />
        <ApiKeysSection />
      </div>
    </div>
  );
}
