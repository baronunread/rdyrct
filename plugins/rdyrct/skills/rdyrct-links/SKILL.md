---
name: rdyrct-links
description: Use when the user wants to shorten a URL, change or delete a short link, find a link, check how many clicks a link or an organization got, see how many links their plan has left, invite someone to their rdyrct organization, or make a QR code. Uses the rdyrct MCP server.
---

# rdyrct links

rdyrct is a link shortener and QR code generator for organizations. This plugin connects Cursor to rdyrct's MCP server at `https://rdyrct.com/api/mcp`. The first tool call opens rdyrct's sign-in and consent screen (OAuth); any rdyrct account works, on any plan.

## Which tool

| The user wants to                                    | Tool                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shorten a URL                                        | `create_link` (`destination`; optional `title`, `domain` for a custom domain, `slug` on custom domains only) |
| Point a link somewhere else, or change its title     | `update_link` (find it by `slug` or current `destination`; the slug itself stays)                            |
| Delete a link                                        | `delete_link` (by `slug` or `destination`)                                                                   |
| Find links, or list them with click counts           | `list_links` (`query` filters by slug, destination or title)                                                 |
| Clicks on one link: countries, referrers, devices    | `get_link_stats` (`slug`, plus `domain` if it's on a custom domain)                                          |
| How the organization's links are doing overall       | `get_org_stats` (`days`, default 7)                                                                          |
| How many links the plan allows and how many are left | `get_plan_usage`                                                                                             |
| Invite a teammate                                    | `invite_member` (email; role defaults to member)                                                             |
| A QR code for a URL                                  | `generate_qr_code` (returns a PNG)                                                                           |

## Notes

- If the person belongs to more than one organization, ask which one before changing anything, and pass its id.
- A tool can only see or change what the signed-in account is allowed to; reading needs at least viewer access, changing links needs member.
- Plan limits apply exactly as in the app. If a create fails on a limit, say so and show `get_plan_usage`; don't retry.
- Confirm with the user before `delete_link` and `invite_member`: both act on real data and real people.
