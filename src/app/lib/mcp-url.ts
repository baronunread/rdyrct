// A function, not a module-level constant: self-hosted instances serve this
// page from their own domain, and the MCP URL a client needs to add always
// matches the origin it was copied from.
export const mcpUrl = () => `${window.location.origin}/api/mcp`;
