import type { JsonValue } from "@/shared/types";

/** The small WebMCP surface we use until browser types ship with TypeScript. */
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: JsonValue;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: JsonValue, options?: { signal: AbortSignal }) => Promise<string>;
}

interface ModelContext {
  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): Promise<void>;
}

/**
 * Registers a capability only where a supporting browser exposes WebMCP.
 *
 * The rest of the app must remain a normal web app, so an absent or partial
 * experimental implementation is intentionally a no-op rather than an error.
 */
export function registerWebMcpTools(tools: WebMcpTool[]): () => void {
  // SAFETY: WebMCP exposes modelContext on Document; the optional property keeps unsupported browsers a no-op.
  const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!modelContext) return () => {};

  const controller = new AbortController();
  void Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
  ).catch(() => {
    // WebMCP is progressive enhancement. A browser declining a tool must
    // never change what a person can do with the page.
  });
  return () => controller.abort();
}
