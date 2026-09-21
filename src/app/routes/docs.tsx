/**
 * Developer docs: the REST API and the MCP server, each its own chapter
 * behind an anchor (#api, #mcp) rather than separate pages. One person
 * maintains this, and two real chapters do not earn two page loads yet;
 * split the moment a third chapter (an OpenAPI reference, #133) makes the
 * page too long to scan.
 *
 * Its own shell, not <MarketingPage>: that component is a centred hero over
 * prose, right for a page that is selling something. Docs are reference
 * material somebody scans and jumps around in, so this reads left-aligned
 * with a chapter list beside it instead, the shape a person expects from
 * Stripe's or GitHub's docs rather than a landing page. It still reuses
 * MarketingPage's own pieces (header, footer, SEO, the marketing-scroll
 * ride-up) so it stays the same product outside the content area, and the
 * outer width stays max-w-5xl so the footer-width e2e assertion holds.
 */
import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "../components/landing-header";
import { WebMcpMarketingTools } from "../components/webmcp-marketing-tools";
import { Footer } from "../ui/footer";
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
    <section
      id={id}
      className="scroll-mt-20 border-t border-border py-10 first:border-t-0 first:pt-0"
    >
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      <div className="flex flex-col gap-4 text-sm">{children}</div>
    </section>
  );
}

const CHAPTERS = [
  { id: "api", label: "REST API" },
  { id: "mcp", label: "MCP server" },
];

/** The chapter list: a sticky left rail of stacked links from lg up, a row
 * of pills above the content on anything narrower. Same links, two shapes. */
function ChapterNav({ className, pills }: { className?: string; pills?: boolean }) {
  return (
    <nav className={className}>
      {CHAPTERS.map((chapter) =>
        pills ? (
          <MarketingLink
            key={chapter.id}
            to="/docs"
            hash={chapter.id}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text"
          >
            {chapter.label}
          </MarketingLink>
        ) : (
          <MarketingLink
            key={chapter.id}
            to="/docs"
            hash={chapter.id}
            className="block rounded px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text"
          >
            {chapter.label}
          </MarketingLink>
        ),
      )}
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
  const { authed } = useAudience();
  useSeo("/docs");
  useMarketingScroll();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <WebMcpMarketingTools />
          <LandingHeader authed={authed} />

          <main className="pt-10 pb-4 sm:pt-14">
            <h1 className="text-2xl font-bold text-balance">Developer docs</h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              The REST API and the MCP server: how to authenticate, and what each one can do. Both
              are free on every plan.
            </p>

            <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
              <ChapterNav pills className="flex flex-wrap gap-2 lg:hidden" />

              <aside className="hidden w-40 shrink-0 lg:block">
                <ChapterNav className="sticky top-20 flex flex-col gap-0.5" />
              </aside>

              <div className="min-w-0 flex-1">
                <Chapter id="api" title="REST API">
                  <p>
                    Every organization route under{" "}
                    <code className="font-mono">/api/orgs/:orgId</code> answers to a scoped API key
                    the same way it answers to a signed-in browser: create, read, update and delete
                    links, read click analytics, manage domains and members.
                  </p>

                  <h3 className="mt-2 font-bold">Getting a key</h3>
                  <p>
                    While signed in, create one for an organization you own:{" "}
                    <code className="font-mono">POST /api/orgs/:orgId/api-keys</code> with{" "}
                    <code className="font-mono">{`{"name": "..."}`}</code>. The response carries the
                    raw key once. There is no Settings screen for this yet: the routes work today, a
                    button for them is still to come.
                  </p>
                  <p>
                    Revoke one with{" "}
                    <code className="font-mono">DELETE /api/orgs/:orgId/api-keys/:keyId</code>. A
                    revoked key's next request gets a 401 at once, wherever it is used.
                  </p>

                  <h3 className="mt-2 font-bold">Authenticating a request</h3>
                  <CodeBlock>{`GET /api/orgs/org_id/links
Authorization: Bearer rdyrct_live_...`}</CodeBlock>
                  <p>
                    The key resolves to your account, so the usual role check applies: reading needs
                    at least <code className="font-mono">viewer</code>, most writes need{" "}
                    <code className="font-mono">member</code>. Plan caps still apply underneath, the
                    same way they do in the app.
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
                    endpoint, for an AI chatbot's connectors. Same key as the API, above: no
                    separate credential, no OAuth flow yet.
                  </p>

                  <h3 className="mt-2 font-bold">Endpoint</h3>
                  <CodeBlock>https://rdyrct.com/api/mcp</CodeBlock>
                  <p>
                    One address, stateless: nothing to establish before calling a tool, nothing to
                    carry between calls.
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
                    Every tool but <code className="font-mono">generate_qr_code</code> takes an
                    optional <code className="font-mono">org_id</code>. Left out, it assumes your
                    sole organization, and asks which one you mean if you belong to more than one.
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
              </div>
            </div>
          </main>

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
