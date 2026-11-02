/**
 * The MCP tab's setup card (#139 follow-up): pick an assistant, follow its
 * steps, and say when it is added. A token cannot be minted without the
 * person finishing the browser consent screen, so there is no separate
 * "prove it works" step: the grant showing up in the Connected list is that
 * proof, which is what the waiting state polls for.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { CopyButton } from "../ui/copy-button";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { ChartColumn, Link2, Pencil, Search } from "../ui/icons";
import { copyToClipboard } from "../lib/clipboard";
import { useMcpUrl } from "../lib/mcp-url";
import {
  claudeCodeCommand,
  cursorConfig,
  cursorInstallLink,
  vscodeConfig,
  vscodeInstallLink,
} from "../lib/mcp-install";
import { McpAgentPromptButton } from "./mcp-setup-prompt";
import { AssistantMark, type AssistantMarkId } from "./assistant-mark";

export type AssistantId = AssistantMarkId;

interface Assistant {
  id: AssistantId;
  label: string;
}

const ASSISTANTS: readonly Assistant[] = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "claude-code", label: "Claude Code" },
  { id: "other", label: "Other" },
];

export const DEFAULT_ASSISTANT: AssistantId = "claude";

export function isAssistantId(value: string | null): value is AssistantId {
  return ASSISTANTS.some((a) => a.id === value);
}

function AssistantTile({
  assistant,
  selected,
  onSelect,
}: {
  assistant: Assistant;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-xl px-1 py-3 text-xs outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:shadow-[0_0_0_2px_var(--accent)]",
        selected
          ? "bg-surface-2 font-semibold text-text shadow-[0_0_0_2px_var(--accent)]"
          : "text-muted [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text",
      )}
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-[10px] bg-surface text-text smooth-shadow-ring-xs"
      >
        <AssistantMark id={assistant.id} className="size-[22px]" />
      </span>
      <span className="max-w-full truncate">{assistant.label}</span>
    </button>
  );
}

/** A value to copy, in its own field: the URL, a command or a JSON config. */
function CopyField({
  value,
  label,
  block,
  wrap,
}: {
  value: string;
  label: string;
  /** Several lines of code rather than one line. */
  block?: boolean;
  /** A command that may run over several lines on a phone, rather than scroll. */
  wrap?: boolean;
}) {
  const toast = useToast();
  return (
    <div className="flex items-start gap-1 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3">
      {block ? (
        <pre className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs leading-relaxed">
          {value}
        </pre>
      ) : (
        <code
          className={cn(
            "min-w-0 flex-1 py-1.5 font-mono text-xs",
            wrap ? "break-words" : "overflow-x-auto whitespace-nowrap",
          )}
        >
          {value}
        </code>
      )}
      <CopyButton text={value} label={label} onCopy={(text) => copyToClipboard(text, toast)} />
    </div>
  );
}

function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="flex flex-col">
      {children.map((step, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold smooth-shadow-ring-xs">
              {i + 1}
            </span>
            {i < children.length - 1 && <span aria-hidden className="my-1 w-px flex-1 bg-border" />}
          </div>
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-2 pt-0.5 text-sm",
              i < children.length - 1 && "pb-5",
            )}
          >
            {step}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ClaudeSteps() {
  return (
    <Steps>
      <p>In Claude, go to Settings → Connectors and select Add custom connector.</p>
      <p>Paste the URL above.</p>
      <p>Select Add. Claude opens this page to sign you in and ask for your approval.</p>
    </Steps>
  );
}

function ChatgptSteps() {
  return (
    <Steps>
      <p>
        In ChatGPT, go to Settings → Apps & Connectors → Advanced settings and turn on Developer
        mode (Plus, Pro or Enterprise only).
      </p>
      <p>
        Under Connectors, select Add custom connector, paste the URL above, and choose OAuth as the
        authentication method.
      </p>
      <p>Start a new chat, select + → More → Developer mode, and pick this connector to sign in.</p>
    </Steps>
  );
}

function CursorSteps({ url }: { url: string }) {
  return (
    <Steps>
      <>
        <p>Add the server. Cursor opens and asks you to confirm.</p>
        <div>
          <a href={cursorInstallLink(url)} className={buttonClass({ variant: "primary" })}>
            Add to Cursor
          </a>
        </div>
      </>
      <p>Select Connect next to rdyrct, then sign in and approve access on this site.</p>
      <>
        <p>If the button does nothing, add this to .cursor/mcp.json.</p>
        <CopyField block value={cursorConfig(url)} label="Copy Cursor config" />
      </>
    </Steps>
  );
}

function VscodeSteps({ url }: { url: string }) {
  return (
    <Steps>
      <>
        <p>Add the server. VS Code opens and asks you to confirm.</p>
        <div>
          <a href={vscodeInstallLink(url)} className={buttonClass({ variant: "primary" })}>
            Add to VS Code
          </a>
        </div>
      </>
      <p>Select Start on the server when VS Code offers it, then sign in and approve access.</p>
      <>
        <p>If the button does nothing, add this to .vscode/mcp.json.</p>
        <CopyField block value={vscodeConfig(url)} label="Copy VS Code config" />
      </>
    </Steps>
  );
}

function ClaudeCodeSteps({ url }: { url: string }) {
  return (
    <Steps>
      <>
        <p>Run this in your terminal.</p>
        <CopyField wrap value={claudeCodeCommand(url)} label="Copy command" />
      </>
      <p>In Claude Code, run /mcp and select rdyrct to sign in.</p>
      <p>Approve access on this site.</p>
    </Steps>
  );
}

function OtherSteps() {
  return (
    <Steps>
      <p>Find where your tool manages MCP or connector servers.</p>
      <p>Add a remote server over streamable HTTP with the URL above.</p>
      <>
        <p>Sign in when the tool asks. rdyrct supports OAuth, so there is no key to paste.</p>
        <div className="flex flex-wrap items-center gap-2">
          <McpAgentPromptButton />
          <span className="text-xs text-muted">Or have your agent set it up for you.</span>
        </div>
      </>
    </Steps>
  );
}

function StepsFor({ id, url }: { id: AssistantId; url: string }) {
  const steps = {
    claude: <ClaudeSteps />,
    chatgpt: <ChatgptSteps />,
    cursor: <CursorSteps url={url} />,
    vscode: <VscodeSteps url={url} />,
    "claude-code": <ClaudeCodeSteps url={url} />,
    other: <OtherSteps />,
  } satisfies Record<AssistantId, ReactNode>;
  return steps[id];
}

/** Taken from the tools the Worker lists (src/worker/routes/mcp.ts). */
const CAPABILITIES = [
  {
    icon: Link2,
    title: "Make links",
    hint: "Shorten a URL, on any of your domains, with a QR code.",
  },
  { icon: Search, title: "Find links", hint: "Search by slug, destination or title." },
  {
    icon: ChartColumn,
    title: "Read your clicks",
    hint: "Totals, top links, countries, referrers and devices.",
  },
  { icon: Pencil, title: "Change where a link goes", hint: "Point it at a new destination." },
] as const;

function Capabilities() {
  return (
    <div>
      <p className="text-sm font-semibold">What it can do</p>
      <ul className="mt-3 flex flex-col gap-3.5">
        {CAPABILITIES.map(({ icon: Icon, title, hint }) => (
          <li key={title} className="flex gap-3">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
            >
              <Icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-pretty text-muted">{hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WaitRow({
  waiting,
  onStart,
  onCancel,
}: {
  waiting: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  if (!waiting)
    return (
      <div>
        <Button variant="outline" onClick={onStart}>
          I've added the server
        </Button>
      </div>
    );
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5"
    >
      <Spinner />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Waiting for the connection…</p>
        <p className="text-xs text-pretty text-muted">
          Finish signing in and approving access in your AI tool. It shows up under Connected on its
          own.
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** `waiting` is owned by the caller: it polls the connected list while waiting
 * and needs to know the instant a new grant shows up, which lives beside that
 * query, not in here. */
export function McpConnectWizard({
  assistant,
  onAssistantChange,
  waiting,
  onStartWaiting,
  onCancelWaiting,
}: {
  assistant: AssistantId;
  onAssistantChange: (id: AssistantId) => void;
  waiting: boolean;
  onStartWaiting: () => void;
  onCancelWaiting: () => void;
}) {
  const url = useMcpUrl();
  const current = ASSISTANTS.find((a) => a.id === assistant) ?? ASSISTANTS[0]!;

  return (
    <section
      aria-label="Connect an assistant"
      className="grid gap-6 rounded-2xl bg-surface p-4 smooth-shadow-ring-xs sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-8"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div
          role="group"
          aria-label="AI assistant"
          className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
        >
          {ASSISTANTS.map((a) => (
            <AssistantTile
              key={a.id}
              assistant={a}
              selected={a.id === current.id}
              onSelect={() => onAssistantChange(a.id)}
            />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted">MCP server URL</p>
          <CopyField value={url} label="Copy URL" />
        </div>

        <StepsFor id={current.id} url={url} />

        <WaitRow waiting={waiting} onStart={onStartWaiting} onCancel={onCancelWaiting} />
      </div>

      <div className="border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        <Capabilities />
      </div>
    </section>
  );
}
