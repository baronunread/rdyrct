// Cursor: https://cursor.com/docs/context/mcp/install-links (base64 of the mcp.json entry)
// VS Code: https://code.visualstudio.com/api/extension-guides/ai/mcp (encodeURIComponent of the entry)
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

export function cursorConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url } } }, null, 2);
}

export function vscodeConfig(url: string): string {
  return JSON.stringify({ servers: { [MCP_SERVER_NAME]: { type: "http", url } } }, null, 2);
}

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
}
