import { Button } from "../ui/button";
import { Copy } from "../ui/icons";
import { copyToClipboard } from "../lib/clipboard";
import { useMcpUrl } from "../lib/mcp-url";
import { useToast } from "../ui/toast";

// The prompt covers both paths a client can take, since the agent won't know which applies:
// OAuth, or a minted API key as a bearer header.
function agentPrompt(url: string) {
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

export function McpAgentPromptButton() {
  const toast = useToast();
  const url = useMcpUrl();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void copyToClipboard(agentPrompt(url), toast).catch(() => {})}
      className="shrink-0"
    >
      <Copy size={14} /> Copy prompt
    </Button>
  );
}
