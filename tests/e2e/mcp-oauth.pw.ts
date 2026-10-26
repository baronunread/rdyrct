import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { appUrl } from "./environment";
import { rawSql } from "./db";
import { signUpAndVerify } from "./resend";

const E2E_PASSWORD = "test-password-123";
// A real, resolvable domain, not a documentation-only one (.example/.test):
// the browser actually navigates here when consent completes, and a
// non-resolving host would fail that navigation before waitForRequest ever
// sees it.
const REDIRECT_URI = "https://example.com/callback";
const RESOURCE = `${appUrl}/api/mcp`;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Registers a test MCP client the way Claude or Cursor does: anonymous
 * dynamic client registration, no session cookie. The resource row is
 * written first because mcp() only creates it lazily, on its own first
 * request after the dev server boots. */
async function registerTestClient(page: Page, request: APIRequestContext): Promise<string> {
  await rawSql(
    page,
    `insert or ignore into oauth_resource (id, identifier, name, created_at, updated_at)
     values (?, ?, 'rdyrct MCP', 0, 0)`,
    [`resource-${Date.now()}`, RESOURCE],
  );
  const res = await request.post(`${appUrl}/api/auth/oauth2/register`, {
    data: {
      client_name: "Playwright Client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(res.status()).toBe(201);
  const { client_id } = await res.json();
  return client_id;
}

test("connects an MCP client via OAuth consent, then revokes it from Connected apps", async ({
  page,
  request,
}) => {
  await signUpAndVerify(page, `mcp-oauth-${Date.now()}@gmail.com`, E2E_PASSWORD);

  const clientId = await registerTestClient(page, request);
  const { verifier, challenge } = pkcePair();

  const authorizeUrl = new URL(`${appUrl}/api/auth/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid profile email",
    state: "e2e",
  }).toString();

  await page.goto(authorizeUrl.toString());
  await expect(page.getByText("Playwright Client wants access")).toBeVisible();
  await expect(page.getByText("Your answer goes to example.com")).toBeVisible();

  // The consent page's own success handler does a real
  // window.location.assign to the client's redirect_uri, leaving this app's
  // origin: wait for that navigation (not its response, which CI's sandbox
  // may not be able to fetch) rather than a raw network-request listener.
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL(`${REDIRECT_URI}*`);
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toBeTruthy();

  // The `request` fixture, not `page.request`: the page has just navigated
  // to example.com to get here, and page.request ties its behavior to the
  // page's current (now cross-origin) browsing context. This one is its own
  // independent APIRequestContext, the same shape api-keys.pw.ts's `request`
  // calls already use successfully.
  const tokenRes = await request.post(`${appUrl}/api/auth/oauth2/token`, {
    form: {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(tokenRes.ok()).toBe(true);
  const { access_token } = await tokenRes.json();
  expect(access_token).toBeTruthy();

  const mcpRes = await request.post(`${appUrl}/api/mcp`, {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcpRes.status()).toBe(200);

  // Connected apps live under the MCP tab, not the default (API keys) one.
  await page.goto(`${appUrl}/api-keys?tab=mcp`);
  await expect(page.getByText("Playwright Client")).toBeVisible();
  await page.getByRole("button", { name: "Revoke Playwright Client" }).click();
  await page.getByRole("button", { name: "Disconnect app" }).click();
  // Back to zero connections: the connect guide, not a bare empty line.
  await expect(page.getByText("Connect an AI assistant", { exact: true })).toBeVisible();

  const revokedMcpRes = await request.post(`${appUrl}/api/mcp`, {
    headers: {
      authorization: `Bearer ${access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  // The live JWT itself is still valid (stateless, see docs.tsx's OAuth
  // section): what revoke actually kills is the ability to mint another one.
  // See tests/worker/mcp-oauth.worker.ts for that half of the contract.
  expect(revokedMcpRes.status()).toBe(200);
});
