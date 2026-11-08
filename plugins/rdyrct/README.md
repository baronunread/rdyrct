# rdyrct for Cursor

Create and manage [rdyrct](https://rdyrct.com) short links from Cursor: shorten a URL, point a link somewhere else, read click stats by country, referrer and device, check plan usage, invite a teammate, or make a QR code.

## What's in it

- `mcp.json`: rdyrct's MCP server, `https://rdyrct.com/api/mcp`.
- `skills/rdyrct-links`: tells the agent which rdyrct tool fits the request.

## Sign-in

The server uses OAuth 2.1. The first time a tool runs, Cursor opens rdyrct's sign-in and a consent screen naming Cursor; nothing to copy. Any rdyrct account works, on any plan, and you can revoke access from the API page's MCP tab. Clients that need a static token can use an rdyrct API key instead (see [the docs](https://rdyrct.com/docs)).

## Tools

`create_link`, `update_link`, `delete_link`, `list_links`, `get_link_stats`, `get_org_stats`, `get_plan_usage`, `invite_member`, `generate_qr_code`.

## License

MIT, like the rest of this repository. [Terms](https://rdyrct.com/terms) · [Privacy](https://rdyrct.com/privacy)
