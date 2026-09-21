import { Button } from "../ui/button";
import { Copy } from "../ui/icons";
import { copyToClipboard } from "../lib/clipboard";
import { useToast } from "../ui/toast";

/** The endpoint and header an MCP client's "Add custom connector" form asks
 * for, as one paste instead of two fields copied separately. Takes the real
 * key right after minting; everywhere else (docs, an already-closed banner)
 * a reader fills in their own. Outline, not primary: it sits beside a real
 * primary action (Create key) on the keys page and the accent has one job. */
export function McpSetupCopyButton({ apiKey }: { apiKey?: string }) {
  const toast = useToast();
  const text = `URL: https://rdyrct.com/api/mcp
Header: Authorization: Bearer ${apiKey ?? "YOUR_API_KEY"}`;
  return (
    <Button variant="outline" size="sm" onClick={() => copyToClipboard(text, toast)}>
      <Copy size={14} /> Copy MCP setup
    </Button>
  );
}
