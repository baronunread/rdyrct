import { useEffect, useRef, useState } from "react";
import { AssistantMark, markForClient } from "./assistant-mark";
import { errorMessage } from "@/app/lib/error-message";
import { useSearchParams } from "../lib/router-search";
import { useConnectedApps, useRevokeConnectedApp, type ConnectedApp } from "../lib/hooks";
import { relativeDate } from "../lib/dates";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import {
  DEFAULT_ASSISTANT,
  McpConnectWizard,
  isAssistantId,
  type AssistantId,
} from "./mcp-connect-wizard";

/** The open assistant, kept in the URL (?client=cursor) beside ?tab=mcp so a
 * reload, or a link to a teammate, lands on the same steps. The default has
 * no param of its own. */
function useAssistant(): [AssistantId, (id: AssistantId) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("client");
  const assistant = isAssistantId(raw) ? raw : DEFAULT_ASSISTANT;
  const setAssistant = (id: AssistantId) => {
    const next = new URLSearchParams(params);
    if (id === DEFAULT_ASSISTANT) next.delete("client");
    else next.set("client", id);
    setParams(next, { replace: true });
  };
  return [assistant, setAssistant];
}

/** Waits for a new grant to appear in the Connected list: there is no webhook
 * for "finished the OAuth flow in your AI tool", so a new id showing up in
 * this query, polled while waiting, is the only signal there is. */
function useWaitForConnection() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const apps = useConnectedApps(waiting);

  useEffect(() => {
    if (!waiting) return;
    const fresh = apps.data?.find((app) => !knownIds.current.has(app.id));
    if (!fresh) return;
    toast(`${fresh.clientName} connected`);
    setWaiting(false);
  }, [waiting, apps.data, toast]);

  return {
    apps,
    waiting,
    start: () => {
      knownIds.current = new Set((apps.data ?? []).map((app) => app.id));
      setWaiting(true);
    },
    cancel: () => setWaiting(false),
  };
}

/** The hero: what the connection is for, over one soft glow of the accent in
 * a corner. The glow is decoration, so it is hidden from assistive tech and
 * never sits behind more than the title. */
function McpHero() {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-surface-2 p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 -z-10 size-[26rem] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_30%,transparent),color-mix(in_oklab,var(--accent)_8%,transparent)_60%,transparent)]"
      />
      <h2 className="max-w-md text-xl font-semibold text-balance">
        Use rdyrct from your AI assistant
      </h2>
      <p className="mt-1.5 max-w-xl text-sm text-pretty text-muted">
        It can make links, find them and read their clicks. It signs in as you, so it reaches the
        organizations you belong to and nothing else.
      </p>
    </section>
  );
}

/** The client's own mark when its name says which assistant it is, else
 * its initial. */
function ClientMark({ name }: { name: string }) {
  const mark = markForClient(name);
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted smooth-shadow-ring-xs"
    >
      {mark ? (
        <AssistantMark id={mark} className="size-[18px] text-text" />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

function ConnectedRow({ app, onDisconnect }: { app: ConnectedApp; onDisconnect: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <ClientMark name={app.clientName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{app.clientName}</p>
        <p className="tnum text-xs text-muted">Last used {relativeDate(app.lastUsedAt)}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Disconnect ${app.clientName}`}
        onClick={onDisconnect}
      >
        Disconnect
      </Button>
    </li>
  );
}

function ConnectedList({
  apps,
  onDisconnect,
}: {
  apps: ConnectedApp[];
  onDisconnect: (app: ConnectedApp) => void;
}) {
  return (
    <section aria-label="Connected">
      <h3 className="text-sm font-semibold">Connected</h3>
      <ul className="mt-1 flex flex-col divide-y divide-border/60">
        {apps.map((app) => (
          <ConnectedRow key={app.id} app={app} onDisconnect={() => onDisconnect(app)} />
        ))}
      </ul>
    </section>
  );
}

function ConnectedSection({
  loading,
  apps,
  onDisconnect,
}: {
  loading: boolean;
  apps: ConnectedApp[] | undefined;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  if (loading) return <Skeleton className="h-14 w-full rounded-lg" />;
  if (!apps || apps.length === 0) return null;
  return <ConnectedList apps={apps} onDisconnect={onDisconnect} />;
}

function useDisconnect() {
  const toast = useToast();
  const revokeApp = useRevokeConnectedApp();
  const [target, setTarget] = useState<ConnectedApp | null>(null);
  const confirm = async () => {
    if (!target) return;
    try {
      await revokeApp.mutateAsync(target.id);
      toast("Disconnected");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setTarget(null);
    }
  };
  return { target, setTarget, confirm, pending: revokeApp.isPending };
}

/** The MCP tab: the hero, the assistants already connected (per user, open
 * to every member: authorizing one is a session action, not minting a
 * standing credential), and how to connect another. */
export function McpTab() {
  const [assistant, setAssistant] = useAssistant();
  const { apps, waiting, start, cancel } = useWaitForConnection();
  const disconnect = useDisconnect();

  return (
    <div className="flex flex-col gap-6">
      <McpHero />

      <ConnectedSection
        loading={apps.isLoading}
        apps={apps.data}
        onDisconnect={disconnect.setTarget}
      />

      <McpConnectWizard
        assistant={assistant}
        onAssistantChange={setAssistant}
        waiting={waiting}
        onStartWaiting={start}
        onCancelWaiting={cancel}
      />

      <ConfirmDialog
        title="Disconnect app"
        open={!!disconnect.target}
        onClose={() => disconnect.setTarget(null)}
        onConfirm={disconnect.confirm}
        confirmLabel="Disconnect app"
        danger
        pending={disconnect.pending}
      >
        <p className="text-sm">
          <strong>{disconnect.target?.clientName}</strong> can't get a new token after this.
          Anything it already has keeps working for up to an hour, until that token expires.
        </p>
      </ConfirmDialog>
    </div>
  );
}
