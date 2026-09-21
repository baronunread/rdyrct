import { Button } from "../ui/button";
import { Copy } from "../ui/icons";
import { copyToClipboard } from "../lib/clipboard";
import { useToast } from "../ui/toast";

export const MCP_URL = "https://rdyrct.com/api/mcp";

/** The endpoint and header an MCP client's "Add custom connector" form asks
 * for, as one paste instead of two fields copied separately, for a client
 * that takes a bearer key rather than doing OAuth itself. Takes the real
 * key right after minting; everywhere else (docs, an already-closed banner)
 * a reader fills in their own. Outline, not primary: it sits beside a real
 * primary action (Create key) on the API keys tab and the accent has one
 * job. */
export function McpSetupCopyButton({ apiKey }: { apiKey?: string }) {
  const toast = useToast();
  const text = `URL: ${MCP_URL}
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
      onClick={() => copyToClipboard(MCP_URL, toast)}
      className="shrink-0"
    >
      <Copy size={14} /> Copy URL
    </Button>
  );
}
