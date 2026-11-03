import { expect, test } from "bun:test";
import {
  cursorInstallLink,
  vscodeInstallLink,
  claudeCodeCommand,
} from "../src/app/lib/mcp-install";

const MCP = "https://rdyrct.com/api/mcp";

test("the Cursor link carries the base64 of the server entry", () => {
  const link = new URL(cursorInstallLink(MCP));
  expect(link.protocol).toBe("cursor:");
  expect(link.host).toBe("anysphere.cursor-deeplink");
  expect(link.pathname).toBe("/mcp/install");
  expect(link.searchParams.get("name")).toBe("rdyrct");
  expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: MCP });
});

test("the VS Code link is the URL-encoded JSON of the server", () => {
  const link = vscodeInstallLink(MCP);
  expect(link.startsWith("vscode:mcp/install?")).toBe(true);
  expect(JSON.parse(decodeURIComponent(link.split("?")[1]!))).toEqual({
    name: "rdyrct",
    type: "http",
    url: MCP,
  });
});

test("the Claude Code command names the transport and URL", () => {
  expect(claudeCodeCommand(MCP)).toBe(`claude mcp add --transport http rdyrct ${MCP}`);
});
