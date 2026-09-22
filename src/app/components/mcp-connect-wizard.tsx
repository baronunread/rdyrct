/**
 * The MCP tab's empty state (#139 follow-up): a guided connect flow instead
 * of a bare "no connected apps yet" line, the way Resend walks a new sender
 * through install → authenticate → send a first email. Ours has one fewer
 * step than that: a token literally cannot be minted without the person
 * completing the browser consent screen, so there is no separate "prove it
 * actually works" step to add — the grant showing up here already is that
 * proof, which is what the waiting phase below polls for.
 */
import { useState } from "react";
import { cn } from "../ui/cn";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { McpUrlCopyButton, McpAgentPromptButton } from "./mcp-setup-prompt";
import { mcpUrl } from "../lib/mcp-url";

interface Guide {
  id: string;
  label: string;
  steps: string[];
}

// Only tools whose current UI drives OAuth itself belong here — this tab is
// the OAuth path. A tool that instead wants a pasted bearer key belongs on
// the API keys tab, not a guide here promising a flow it doesn't have.
const GUIDES: Guide[] = [
  {
    id: "claude",
    label: "Claude",
    steps: [
      "In Claude, go to Settings → Connectors and select Add custom connector.",
      "Paste the URL below.",
      "Select Add. Claude opens this page to sign you in and ask for your approval.",
    ],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    steps: [
      "In ChatGPT, go to Settings → Apps & Connectors → Advanced settings and turn on Developer mode (Plus, Pro or Enterprise only).",
      "Under Connectors, select Add custom connector, paste the URL below, and choose OAuth as the authentication method.",
      "Start a new chat, select + → More → Developer mode, and pick this connector to sign in.",
    ],
  },
];

function GuidePicker({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="AI assistant">
      {GUIDES.map((guide) => (
        <button
          key={guide.id}
          type="button"
          role="tab"
          aria-selected={active === guide.id}
          onClick={() => onChange(guide.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            active === guide.id
              ? "border-accent text-accent"
              : "border-border text-muted hover:text-text",
          )}
        >
          {guide.label}
        </button>
      ))}
    </div>
  );
}

function ConnectGuide({ onStartWaiting }: { onStartWaiting: () => void }) {
  const [activeId, setActiveId] = useState(GUIDES[0]!.id);
  const guide = GUIDES.find((g) => g.id === activeId) ?? GUIDES[0]!;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-5">
      <div>
        <p className="text-sm font-bold">Connect an AI assistant</p>
        <p className="mt-0.5 text-xs text-muted">
          Works with any MCP client that supports OAuth. Steps differ by tool:
        </p>
      </div>

      <GuidePicker active={guide.id} onChange={setActiveId} />

      <ol className="flex flex-col gap-2 text-sm">
        {guide.steps.map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="tabular-nums text-muted">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-2 font-mono text-xs">
          {mcpUrl()}
        </code>
        <McpUrlCopyButton />
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <p className="flex-1 text-xs text-muted">
          Or tell your agent to help you set it up for you.
        </p>
        <McpAgentPromptButton />
      </div>

      <div>
        <Button variant="primary" onClick={onStartWaiting}>
          I've added the server
        </Button>
      </div>
    </div>
  );
}

function ConnectWaiting({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
      <Spinner />
      <p className="text-sm font-bold">Waiting for the connection…</p>
      <p className="max-w-sm text-xs text-muted">
        Finish signing in and approving access in your AI tool. This page updates on its own once
        it's connected.
      </p>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Back
      </Button>
    </div>
  );
}

/** `waiting` and `onToggleWaiting` are owned by the caller: it already polls
 * useConnectedApps while waiting and needs to know the instant a new grant
 * shows up, which lives beside that query, not in here. */
export function McpConnectWizard({
  waiting,
  onStartWaiting,
  onCancelWaiting,
}: {
  waiting: boolean;
  onStartWaiting: () => void;
  onCancelWaiting: () => void;
}) {
  return waiting ? (
    <ConnectWaiting onCancel={onCancelWaiting} />
  ) : (
    <ConnectGuide onStartWaiting={onStartWaiting} />
  );
}
