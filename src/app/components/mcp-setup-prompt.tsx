import { Button } from "../ui/button";
import { Copy } from "../ui/icons";
import { copyToClipboard } from "../lib/clipboard";
import { useToast } from "../ui/toast";

// A function, not a module-level constant: self-hosted instances serve this
// page from their own domain, and the MCP URL a client needs to add always
// matches the origin it was copied from.
export const mcpUrl = () => `${window.location.origin}/api/mcp`;

/** The endpoint and header an MCP client's "Add custom connector" form asks
 * for, as one paste instead of two fields copied separately, for a client
 * that takes a bearer key rather than doing OAuth itself. Takes the real
 * key right after minting; everywhere else (docs, an already-closed banner)
 * a reader fills in their own. Outline, not primary: it sits beside a real
 * primary action (Create key) on the API keys tab and the accent has one
 * job. */
export function McpSetupCopyButton({ apiKey }: { apiKey?: string }) {
  const toast = useToast();
  const text = `URL: ${mcpUrl()}
Header: Authorization: Bearer ${apiKey ?? "YOUR_API_KEY"}`;
  return (
    <Button variant="outline" size="sm" onClick={() => copyToClipboard(text, toast)}>
      <Copy size={14} /> Copy MCP setup
    </Button>
  );
}

/** Just the endpoint, for the MCP tab's connect guide: an OAuth client
 * discovers and drives the auth flow itself once it has the URL, so there
 * is no header to paste alongside it (contrast McpSetupCopyButton, above,
 * for a client that instead takes a scoped API key as a bearer header). */
export function McpUrlCopyButton() {
  const toast = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => copyToClipboard(mcpUrl(), toast)}
      className="shrink-0"
    >
      <Copy size={14} /> Copy URL
    </Button>
  );
}

// Coding agents (Claude Code, Cursor, etc.) can be told to wire up a remote
// MCP server themselves rather than walking a person through settings
// screens by hand. The prompt has to cover both paths a client can take,
// since the agent won't know which one applies until it looks: OAuth if the
// tool supports a remote server with sign-in, or a minted API key as a
// bearer header if it only takes a static one. It names one concrete
// command (Claude Code's CLI) as an example, then falls back to "find the
// setting yourself" for everything else, rather than guessing every tool's
// config file.
function agentPrompt() {
  const url = mcpUrl();
  const apiKeysUrl = `${window.location.origin}/api-keys`;
  return `Connect the rdyrct MCP server to this tool.

Server URL: ${url}

It's a remote MCP server over streamable HTTP that supports OAuth 2.1, so most current MCP clients can add it with just the URL and handle sign-in themselves.

1. Find where this tool manages MCP (or "connector") servers.
2. If it supports a remote server with its own sign-in, add one with the URL above. For example, in Claude Code: \`claude mcp add --transport http rdyrct ${url}\`.
3. If it only takes a static bearer token, ask me to mint an API key at ${apiKeysUrl}, then configure the server with the URL above and header \`Authorization: Bearer <the key>\`.
4. If you can't find the setting, tell me exactly which menu or file to edit instead of guessing.

Confirm once it's connected.`;
}

/** Outline, not primary: it sits beside the guide's own primary action
 * ("I've added the server") as an alternative path, not a competing one. */
export function McpAgentPromptButton() {
  const toast = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => copyToClipboard(agentPrompt(), toast)}
      className="shrink-0"
    >
      <Copy size={14} /> Copy prompt
    </Button>
  );
}
