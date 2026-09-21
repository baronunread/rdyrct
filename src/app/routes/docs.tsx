/**
 * Developer docs: the REST API and the MCP server, each its own chapter
 * behind an anchor (#api, #mcp) rather than separate pages. One person
 * maintains this, and two real chapters do not earn two page loads yet;
 * split the moment a third chapter (an OpenAPI reference, #133) makes the
 * page too long to scan.
 *
 * The content mirrors docs/mcp-server.md, written for a person reading in
 * the app rather than for someone reading the repo.
 */
import type { ReactNode } from "react";
import { MarketingPage } from "../components/marketing-page";
import { MarketingLink } from "../components/marketing-link";
import { Table, Th, Td } from "../ui/misc";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border py-12 first:border-t-0">
      <h2 className="mb-6 text-xl font-bold">{title}</h2>
      <div className="flex flex-col gap-4 text-sm">{children}</div>
    </section>
  );
}

const TOC = [
  { id: "api", label: "REST API" },
  { id: "mcp", label: "MCP server" },
];

function TableOfContents() {
  return (
    <nav className="flex flex-wrap justify-center gap-4 pb-8 text-sm">
      {TOC.map((item) => (
        <MarketingLink
          key={item.id}
          to="/docs"
          hash={item.id}
          className="text-accent hover:underline"
        >
          {item.label}
        </MarketingLink>
      ))}
    </nav>
  );
}

interface Tool {
  name: string;
  does: string;
  role: string;
}

const TOOLS: Tool[] = [
  {
    name: "create_link",
    does: "Shorten a URL, optionally with a chosen slug or custom domain",
    role: "member",
  },
  {
    name: "update_link",
    does: "Point an existing link (found by slug or destination) at a new destination or title",
    role: "member",
  },
  { name: "delete_link", does: "Delete a link, found by slug or destination", role: "member" },
  { name: "list_links", does: "Search or list an org's links with click counts", role: "viewer" },
  {
    name: "get_link_stats",
    does: "One link's clicks, countries, referrers and devices",
    role: "viewer",
  },
  {
    name: "get_org_stats",
    does: "Totals, top links, and links with no clicks in 30 days",
    role: "viewer",
  },
  { name: "get_plan_usage", does: "The org's link cap and how much of it is used", role: "viewer" },
  { name: "invite_member", does: "Invite someone to the org by email", role: "admin" },
  {
    name: "generate_qr_code",
    does: "A plain QR code (PNG) for any URL, no org needed",
    role: "none",
  },
];

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function DocsPage() {
  return (
    <MarketingPage
      path="/docs"
      title="Developer docs"
      intro="The REST API and the MCP server: how to authenticate, and what each one can do. Both are free on every plan."
    >
      <TableOfContents />

      <Chapter id="api" title="REST API">
        <p>
          Every organization route under <code className="font-mono">/api/orgs/:orgId</code> answers
          to a scoped API key the same way it answers to a signed-in browser: create, read, update
          and delete links, read click analytics, manage domains and members.
        </p>

        <h3 className="mt-2 font-bold">Getting a key</h3>
        <p>
          While signed in, create one for an organization you own:{" "}
          <code className="font-mono">POST /api/orgs/:orgId/api-keys</code> with{" "}
          <code className="font-mono">{`{"name": "..."}`}</code>. The response carries the raw key
          once. There is no Settings screen for this yet: the routes work today, a button for them
          is still to come.
        </p>
        <p>
          Revoke one with <code className="font-mono">DELETE /api/orgs/:orgId/api-keys/:keyId</code>
          . A revoked key's next request gets a 401 at once, wherever it is used.
        </p>

        <h3 className="mt-2 font-bold">Authenticating a request</h3>
        <CodeBlock>{`GET /api/orgs/org_id/links
Authorization: Bearer rdyrct_live_...`}</CodeBlock>
        <p>
          The key resolves to your account, so the usual role check applies: reading needs at least{" "}
          <code className="font-mono">viewer</code>, most writes need{" "}
          <code className="font-mono">member</code>. Plan caps still apply underneath, the same way
          they do in the app.
        </p>
      </Chapter>

      <Chapter id="mcp" title="MCP server">
        <p>
          A hosted{" "}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            MCP
          </a>{" "}
          endpoint, for an AI chatbot's connectors. Same key as the API, above: no separate
          credential, no OAuth flow yet.
        </p>

        <h3 className="mt-2 font-bold">Endpoint</h3>
        <CodeBlock>https://rdyrct.com/api/mcp</CodeBlock>
        <p>
          One address, stateless: nothing to establish before calling a tool, nothing to carry
          between calls.
        </p>

        <h3 className="mt-2 font-bold">Tools</h3>
        <Table>
          <thead>
            <tr>
              <Th>Tool</Th>
              <Th>Does</Th>
              <Th>Minimum role</Th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map((tool) => (
              <tr key={tool.name}>
                <Td className="font-mono">{tool.name}</Td>
                <Td className="text-muted">{tool.does}</Td>
                <Td>{tool.role}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p>
          Every tool but <code className="font-mono">generate_qr_code</code> takes an optional{" "}
          <code className="font-mono">org_id</code>. Left out, it assumes your sole organization,
          and asks which one you mean if you belong to more than one.
        </p>

        <h3 className="mt-2 font-bold">Calling a tool</h3>
        <CodeBlock>{`POST /api/mcp
Authorization: Bearer rdyrct_live_...
Content-Type: application/json
Accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_link",
    "arguments": { "destination": "https://example.com/blog/post" }
  }
}`}</CodeBlock>
      </Chapter>
    </MarketingPage>
  );
}
