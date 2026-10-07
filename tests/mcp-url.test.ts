import { expect, test } from "bun:test";
import { mcpUrl } from "../src/app/lib/mcp-url";

test("builds an absolute MCP endpoint at the current host root", () => {
  expect(mcpUrl("https://rdyrct.com")).toBe("https://rdyrct.com/api/mcp");
  expect(mcpUrl("http://localhost:8788/nested/path")).toBe("http://localhost:8788/api/mcp");
});
