# The rdyrct MCP server

A remote [MCP](https://modelcontextprotocol.io) server that lets an AI
chatbot create and manage rdyrct links, read analytics, generate QR codes,
and invite teammates, on behalf of a signed-in person. Built for #139; the
tool implementations are `src/worker/routes/mcp.ts`.

This is a different surface from WebMCP (`src/app/components/webmcp-*.tsx`,
`docs/webmcp-demo-script.md`): WebMCP tools run inside a signed-in person's
own browser tab, for a browser agent already on the page. This server runs
remotely, for a chatbot's own "connectors" directory, with no browser
involved at all.

## Hosted endpoint

```
https://rdyrct.com/api/mcp
```

One endpoint, `POST` (and `GET`/`DELETE` per the MCP Streamable HTTP
transport). Stateless: no session to establish first, no
`Mcp-Session-Id` to carry between calls.

## Access requirements

Every request carries a scoped API key as a bearer token:

```
Authorization: Bearer rdyrct_live_...
```

The key resolves to the same signed-in identity a browser session would,
and every tool call is authorized exactly the way the equivalent app action
is: the org named in the call (or the person's sole org, if they only have
one) has to actually have that person as a member, at the role the action
needs (read tools ask for `viewer`, most writes ask for `member`, inviting
someone asks for `admin`).

**Getting a key today**: `POST /api/orgs/:orgId/api-keys` while signed in
with a session cookie, as the org's owner (`{"name": "..."}` in the body,
the raw key comes back once in the response). There is no Settings UI for
this yet (#134): the routes exist, the screen to reach them without
knowing the endpoint by hand does not.

**Revocation**: `DELETE /api/orgs/:orgId/api-keys/:keyId`, same auth. Takes
effect immediately: a revoked key's next request gets a 401, whether that
request is to the MCP server or to the REST API directly (see below).

**Plan**: available on every plan (free, hobby, pro), no gate. Usual plan
caps still apply underneath (a free org's `create_link` still hits the
30-link ceiling); see #238 for why this isn't OAuth yet.

## Not MCP-specific

The same key authenticates the REST API directly: `Authorization: Bearer
rdyrct_live_...` against any `/api/orgs/:orgId/...` route works the same
way a browser session would. The MCP server is a second interface onto the
same authorization, not a separate credential story.

## Tools

| Tool               | Does                                                                                | Minimum role |
| ------------------ | ----------------------------------------------------------------------------------- | ------------ |
| `create_link`      | Shorten a URL, optionally with a chosen slug or custom domain                       | member       |
| `update_link`      | Point an existing link (found by slug or destination) at a new destination or title | member       |
| `delete_link`      | Delete a link, found by slug or destination                                         | member       |
| `list_links`       | Search or list an org's links with click counts                                     | viewer       |
| `get_link_stats`   | One link's clicks, countries, referrers and devices                                 | viewer       |
| `get_org_stats`    | Totals, top links, and links with no clicks in 30 days                              | viewer       |
| `get_plan_usage`   | The org's link cap and how much of it is used                                       | viewer       |
| `invite_member`    | Invite someone to the org by email                                                  | admin        |
| `generate_qr_code` | A plain QR code (PNG) for any URL, no org needed                                    | none         |

Every tool but `generate_qr_code` takes an optional `org_id`; omitted, it
assumes the person's sole organization, and asks which one they mean if
they belong to more than one.

## Example

```
POST /api/mcp
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
}
```
