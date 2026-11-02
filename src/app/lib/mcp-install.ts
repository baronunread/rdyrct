/**
 * One-click install links for editors that have them. The server is remote
 * over streamable HTTP with OAuth, so its whole config is the URL.
 *
 * Cursor: https://cursor.com/docs/context/mcp/install-links
 *   cursor://anysphere.cursor-deeplink/mcp/install?name=NAME&config=BASE64
 *   where config is the base64 of the JSON.stringify'd mcp.json entry.
 * VS Code: https://code.visualstudio.com/api/extension-guides/ai/mcp
 *   vscode:mcp/install?ENCODED where ENCODED is encodeURIComponent of the
 *   JSON.stringify'd {"name", ...server config}.
 */
const MCP_SERVER_NAME = "rdyrct";

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes));
}

export function cursorInstallLink(url: string): string {
  const config = base64(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

export function vscodeInstallLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url }),
  )}`;
}

/** The fallback for Cursor (.cursor/mcp.json). */
export function cursorConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url } } }, null, 2);
}

/** The fallback for VS Code (.vscode/mcp.json). */
export function vscodeConfig(url: string): string {
  return JSON.stringify({ servers: { [MCP_SERVER_NAME]: { type: "http", url } } }, null, 2);
}

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
}
