/**
 * What each public page calls itself in a search result and a link preview.
 *
 * Shared because two places need the same strings and must not drift: the
 * Worker writes them into the HTML it serves (src/worker/page-meta.ts), and
 * the SPA re-applies them on client-side navigation, where no new document is
 * fetched and the head would otherwise still describe the page somebody
 * arrived on.
 *
 * The homepage opens with the brand, as Dub, Bitly and Short.io do, then
 * says what it is: "URL shortener" and "QR code generator" are the searches.
 * The tool pages lead with the search itself. None says "free": a free plan
 * is a fact for the page to state, not a title.
 */
export interface PageMeta {
  title: string;
  description: string;
  /** A hand-written representation for clients that prefer Markdown. */
  markdown?: string;
}

export const PRERENDERED_PUBLIC_PATHS = new Set<string>([
  "/",
  "/pricing",
  "/qr-code-generator",
  "/utm-builder",
  "/branded-link-shortener",
  "/docs",
  "/roadmap",
  "/changelog",
  "/compare",
  "/bitly-alternative",
  "/rebrandly-alternative",
  "/dub-alternative",
  "/short-io-alternative",
  "/privacy",
  "/terms",
  "/report",
]);

/**
 * What index.html ships, and therefore what every page that has no entry of
 * its own should read. Kept here rather than left implicit in the HTML: the
 * client hook has to put this back when it leaves a public page, and
 * "restore whatever the document arrived with" is wrong for exactly the
 * visitor who arrived on the public page itself.
 */
export const DEFAULT_PAGE_META: PageMeta = {
  title: "rdyrct - URL shortener and QR code generator",
  description:
    "URL shortener and QR code generator for teams: branded short links on your own domain, custom QR codes, and privacy-friendly click analytics.",
};

export const PUBLIC_PAGE_META = {
  "/": {
    title: "rdyrct - URL shortener and QR code generator",
    description:
      "URL shortener and QR code generator for teams: branded short links on your own domain, custom QR codes, and privacy-friendly click analytics.",
    markdown: `# rdyrct

rdyrct is a URL shortener and QR code generator for teams. Create short links on a domain people recognise, make branded QR codes, and see privacy-friendly click analytics.

## What you can do

- Shorten a link without an account, then sign up to manage it.
- Use a custom domain for links whose slug you choose.
- Make QR codes with a logo, colours, rounded dots, and PNG or SVG downloads.
- See click country, referrer, device type, and time. rdyrct never stores an IP address.

## Getting started

[Create a free account](/signup) or [compare plans](/pricing). You can also [self-host rdyrct on Cloudflare](https://github.com/baronunread/rdyrct).`,
  },
  "/qr-code-generator": {
    title: "QR code generator with logo - PNG and SVG, no account",
    description:
      "Make a custom QR code for free: your logo, your colors, rounded dots, and a PNG or SVG download. No sign-up, no watermark, and the code is made in your browser.",
    markdown: `# QR code generator

Make a QR code for a link or any text. Add your logo, choose colours and dot styles, then download a PNG or SVG. This QR code generator works in your browser, with no account or watermark.

## How to make a QR code

1. Enter a link or text in the generator.
2. Choose a dot style and colours, then add an optional logo.
3. Download the finished code as a PNG or SVG.

## PNG and SVG downloads

PNG is a fixed-size image for websites, documents, email, and slides. SVG is a vector file that stays sharp when a printer scales it for a poster or package. Open the downloaded file at its intended size and scan it with a phone before printing a large batch.

## Static QR codes and tracking

This generator makes static QR codes: the link or text is stored in the pattern itself. The code does not expire and has no scan limit, but changing its destination means making a new code. To measure scans or change where a code leads later, make a QR code for a short link you manage. The short link can count visits while the QR code stays the same.

The QR code and optional logo are processed in your browser. rdyrct does not receive or store the value you enter or the logo you choose.

[Open the QR code generator](/qr-code-generator)`,
  },
  "/branded-link-shortener": {
    title: "Branded link shortener - short links on your own domain",
    description:
      "A branded link shortener for your own domain: chosen slugs, TLS set up for you, QR codes and click analytics. From $4 a month, with a free plan.",
    markdown: `# Branded link shortener

Put short links on your own domain, such as go.yourcompany.com/spring, instead of a generic shortener's. People see who sent the link and what is behind it before they tap it.

## Set up in three steps

1. At your DNS provider, add a CNAME record for a hostname you own.
2. Add the hostname in rdyrct. We see the record and issue a TLS certificate for it.
3. Make links with words you choose. Each gets a QR code and click analytics by country, referrer and device.

## What it costs

- Free: rdyrct's shared domain with random slugs. No custom domain.
- Hobby, $4 a month: 1 custom domain, slugs you choose, 500 links.
- Pro, $9 a month: 5 custom domains, 3,000 links, 25 members.

Moving from Bitly, Rebrandly, Short.io or Dub? Import your links and keep the same short URLs.

[See rdyrct and Rebrandly compared](/rebrandly-alternative) or [sign up free](/signup).`,
  },
  "/utm-builder": {
    title: "UTM builder - tag links for Google Analytics, no account",
    description:
      "Build a UTM link for free: add source, medium, campaign, term and content to any URL, check the values are lowercase, then copy it or shorten it. No sign-up.",
    markdown: `# UTM builder

Add UTM parameters to a link so Google Analytics and other tools can tell which campaign sent each visitor. Fill in the fields, copy the tagged link, or shorten it. No account needed.

## The parameters

- \`utm_source\`: the site, newsletter or app that sent the visitor. Required by Google Analytics.
- \`utm_medium\`: the channel, such as email, social, cpc, banner or qr. Required by Google Analytics.
- \`utm_campaign\`: the campaign name, so every link in one campaign reports together.
- \`utm_term\`: the paid keyword. Most links leave it out.
- \`utm_content\`: which link of several in one place was clicked. Use it for A/B tests.

## Keep one spelling per value

UTM values are case sensitive. "Spring-Sale" and "spring-sale" show up as two campaigns. Use lowercase with hyphens everywhere; the builder warns when a value strays from it.

The link is built in your browser. Nothing you type is sent anywhere unless you shorten it.

[Open the UTM builder](/utm-builder)`,
  },
  "/pricing": {
    title: "URL shortener and QR code generator pricing - rdyrct",
    description:
      "Free, Hobby and Pro plans for rdyrct: short links, custom domains, branded QR codes and click analytics. Start free, or self-host on your Cloudflare account.",
    markdown: `# rdyrct pricing

rdyrct is an organization-based link shortener and QR code generator that runs entirely on Cloudflare.

## Free: $0/month

- 30 links
- 3 team members
- 7-day click analytics
- 5,000 clicks counted a month
- Plain QR codes
- Random slugs on the shared domain
- 1 organization

[Sign up free](/signup)

## Hobby: $4/month

- 500 links
- 5 team members
- 30-day click analytics
- 50,000 clicks counted a month
- QR codes with a logo, colours, and dot styles
- 1 custom domain, with any slug you choose
- 1 organization

[Start Hobby](/signup?next=%2Fbilling%3Fplan%3Dhobby)

## Pro: $9/month

- 3,000 links
- 25 team members
- 365-day click analytics
- 500,000 clicks counted a month
- QR codes with a logo, colours, and dot styles
- 5 custom domains, with any slug you choose
- 3 organizations
- Direct email support

[Start Pro](/signup?next=%2Fbilling%3Fplan%3Dpro)

## Self-hosting

rdyrct is MIT licensed. Deploy it to your own Cloudflare account and set your own plan. You get everything Pro has except direct email support, for the cost of your own Cloudflare bill.

[Read the deploy guide](https://github.com/baronunread/rdyrct)

## Notes

- Billing is per user, not per organization. An organization's limits come from its owner's plan.
- Slugs on the shared domain are always random. Choosing a slug needs a custom domain.
- Clicks are counted per organization per calendar month (UTC). Past the plan's count, links keep redirecting; only that month's later clicks go unrecorded.
- Click analytics never store an IP address.`,
  },
  "/docs": {
    title: "rdyrct developer docs - REST API and MCP server",
    description:
      "How to authenticate against the rdyrct REST API and its hosted MCP server: getting an API key, the endpoints, and the full MCP tool list. Free on every plan.",
    markdown: `# rdyrct developer docs

The REST API answers to a scoped API key. The MCP server answers to OAuth (recommended) or the same key. Both are free on every plan.

## REST API

Every organization route under \`/api/orgs/:orgId\` answers to a key the same way it answers to a signed-in browser: create, read, update and delete links, read click analytics, manage domains and members.

**Getting a key**: while signed in, create one for an organization you own from [API keys](/api-keys), or directly: \`POST /api/orgs/:orgId/api-keys\` with \`{"name": "..."}\`. The response carries the raw key once.

**Revoking one**: \`DELETE /api/orgs/:orgId/api-keys/:keyId\`, or from the same page. Takes effect at once.

\`\`\`
GET /api/orgs/org_id/links
Authorization: Bearer rdyrct_live_...
\`\`\`

## MCP server

A hosted [MCP](https://modelcontextprotocol.io) endpoint at \`{{MCP_URL}}\`, stateless, for an AI chatbot's connectors.

**OAuth (recommended)**: rdyrct is a full OAuth 2.1 authorization server for this endpoint. Point an MCP client at the URL above and it discovers the flow itself from \`/.well-known/oauth-protected-resource/api/mcp\`, no key to copy or lose. Revoke a connection any time from [API keys](/api-keys)' MCP tab.

**API key**: the same scoped key as the REST API works too, with the same header.

Tools: \`create_link\`, \`update_link\`, \`delete_link\`, \`list_links\`, \`get_link_stats\`, \`get_org_stats\`, \`get_plan_usage\`, \`invite_member\`, \`generate_qr_code\`. Every tool but the last takes an optional \`org_id\`, and assumes your sole organization when it is left out.

\`\`\`
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
\`\`\``,
  },
  "/changelog": {
    title: "rdyrct changelog - what changed in each release",
    description:
      "What changed in each release of rdyrct, the open-source URL shortener and QR code generator: new features, fixes, and anything an upgrade changes for self-hosters.",
    markdown: `# rdyrct changelog

What changed in each release. The full text is [CHANGELOG.md](https://github.com/baronunread/rdyrct/blob/main/CHANGELOG.md) in the repository, and every change is a [merged pull request](https://github.com/baronunread/rdyrct/pulls?q=is%3Apr+is%3Amerged).`,
  },
  "/compare": {
    title: "Compare rdyrct with Bitly, Rebrandly, Dub and Short.io",
    description:
      "How rdyrct compares with Bitly, Rebrandly, Dub and Short.io on price, custom domains, link limits and analytics, and when each other tool is the better pick.",
    markdown: `# Compare rdyrct with other link shorteners

- [rdyrct vs Bitly](/bitly-alternative)
- [rdyrct vs Rebrandly](/rebrandly-alternative)
- [rdyrct vs Dub](/dub-alternative)
- [rdyrct vs Short.io](/short-io-alternative)

Each page compares price, custom domains, link limits and analytics history, and says where the other tool is the better choice.`,
  },
  "/bitly-alternative": {
    title: "Bitly alternative: rdyrct vs Bitly pricing and limits",
    description:
      "rdyrct against Bitly: what each costs with a custom domain, the link and analytics limits, and when Bitly is still the better choice. Free plan, no card.",
    markdown: `# Bitly alternative: rdyrct vs Bitly

Bitly's first plan with a custom domain is Growth at $29 a month on annual billing. rdyrct includes one from $4 a month. If you need an enterprise contract, Bitly is the safer pick.

[Compare in full](/bitly-alternative) or [see rdyrct pricing](/pricing).`,
  },
  "/rebrandly-alternative": {
    title: "Rebrandly alternative: rdyrct vs Rebrandly pricing, limits",
    description:
      "rdyrct against Rebrandly: plan prices, custom domains, link and QR limits, and the one thing Rebrandly's free plan gives that ours does not. Start free, no card.",
    markdown: `# Rebrandly alternative: rdyrct vs Rebrandly

Rebrandly's free plan includes a custom domain and rdyrct's does not. Past the free plans, rdyrct costs less: a custom domain from $4 a month.

[Compare in full](/rebrandly-alternative) or [see rdyrct pricing](/pricing).`,
  },
  "/dub-alternative": {
    title: "Dub alternative: rdyrct vs Dub pricing and limits",
    description:
      "rdyrct against Dub: plan prices, custom domains, link and event limits, and when Dub's volume is worth $90 a month. Start free, no card.",
    markdown: `# Dub alternative: rdyrct vs Dub

Dub's pricing page lists no free plan, and its plans start at $90 a month. rdyrct includes a custom domain from $4 a month. If you create thousands of links a month, Dub is built for that.

[Compare in full](/dub-alternative) or [see rdyrct pricing](/pricing).`,
  },
  "/short-io-alternative": {
    title: "Short.io alternative: rdyrct vs Short.io pricing and limits",
    description:
      "rdyrct against Short.io: plans, custom domains, link and click limits, and where Short.io's bigger free plan wins. We never store a visitor's IP address.",
    markdown: `# Short.io alternative: rdyrct vs Short.io

Short.io beats rdyrct on price and free-plan size. rdyrct is the better pick when click analytics must never store an IP address, or when you want to host the code yourself.

[Compare in full](/short-io-alternative) or [see rdyrct pricing](/pricing).`,
  },
  "/roadmap": {
    title: "URL shortener roadmap - what rdyrct is building next",
    description:
      "What rdyrct is building next, what comes later, and what already works. Every planned item is an open GitHub issue you can read, comment on, or patch.",
    markdown: undefined,
  },
  "/signup": {
    title: "Sign up - rdyrct URL shortener and QR codes",
    description:
      "Create a free rdyrct account: short links with click analytics, QR codes, and UTM tracking for your team. No card required.",
    markdown: undefined,
  },
  "/report": {
    title: "Report a short link - rdyrct",
    description:
      "Report an rdyrct short link used for phishing, malware or spam. We review every report and stop links that break our terms. Your email is optional.",
    markdown: undefined,
  },
  "/login": {
    title: "Log in - rdyrct",
    description: "Log in to your rdyrct account to manage short links, QR codes and analytics.",
    markdown: undefined,
  },
  "/privacy": {
    title: "Privacy policy - rdyrct never stores your IP address",
    description:
      "What rdyrct stores and what it does not: click analytics keep country, referrer, device and time, never an IP address or a precise location.",
    markdown: `# Privacy policy

This policy explains what rdyrct collects, why, the legal basis for it, and how you can exercise your rights. Last updated 26 October 2026.

## Data controller

Andrea Bruno is the data controller for rdyrct. For a privacy request or question, email [support@mail.rdyrct.com](mailto:support@mail.rdyrct.com).

## Data we collect

We collect your account email address and name, plus the organizations, links, domains, and settings you create. Click analytics keep only an approximate country, referrer host, device type, and timestamp. We do not store an IP address, precise location, or data that enables cross-site tracking. If you report a link, we store the address you report, your reason and note, and the email you choose to give.

If you accept analytics, PostHog records product events tied to your account. It does not autocapture what you type or replay your screen. Until you answer the banner, a few steps on the current page are held in browser memory: accepting sends them, rejecting discards them. Sentry receives technical error reports with the error, browser, and page path, after query strings are removed.

## Why we process it

We process account and organization data to provide the service, send transactional email, and provide click analytics. The session cookie is necessary to sign you in. PostHog runs only with your consent, which you can withdraw at any time from Cookie settings. We ask again after six months. We process technical error reports to keep the service secure and reliable. We check where links point against Google's list of unsafe sites to keep phishing and malware off the service. When you sign up, reset a password, shorten a link from the home page, build a UTM link, or report a link, Cloudflare Turnstile reads signals from your browser and connection to check that a person, not a script, sent the form, to keep automated sign-ups and abuse off the service.

## Cookies

rdyrct sets a necessary session cookie. If you accept analytics, PostHog also sets a cookie. We do not use advertising cookies.

## Sub-processors

We use Cloudflare for hosting, storage, and the Turnstile check on forms, Resend for transactional email, Polar for billing, PostHog EU for product analytics, Sentry for error monitoring, and Google Web Risk to check links. Google receives the destination address of a link when the link is created or edited, when we check it again each week, and when its traffic jumps, and checks it against Google's list of unsafe sites. It receives nothing about you or the people who click the link.

## Retention and rights

We retain account and organization data while your account is active. You can access, correct, export, or erase your data, object to or restrict processing, withdraw consent, or delete your account in Settings. If you are in the EU, you may complain to the Italian data protection authority.

For help, email [support@mail.rdyrct.com](mailto:support@mail.rdyrct.com).`,
  },
  "/terms": {
    title: "Terms of service - rdyrct URL shortener and QR codes",
    description:
      "The rules for using rdyrct: acceptable use for links and QR codes, account and organization responsibilities, billing via Polar, and the self-host license.",
    markdown: `# Terms of service

These terms govern your use of rdyrct. By creating an account or using the service, you agree to them. Last updated 25 October 2026.

## Acceptance and acceptable use

Use rdyrct only if you agree to these terms. Do not create links that are illegal, malicious, used for phishing, malware distribution, spam, or other abuse, or that imitate another brand to collect payments or credentials. We may pause or disable a link or account that breaks this rule, block a destination host, and suspend the organizations of a banned account. A pause is not a verdict: we tell the owner why and restore the links if we were wrong.

## Reporting abuse and appeals

Report a link with the [report form](/report). A report alone never suspends a link. On the free plan it shows visitors a warning first, and the link keeps working. To appeal a pause or suspension, email [support@mail.rdyrct.com](mailto:support@mail.rdyrct.com) with the name of your organization and what the link is for.

## Accounts and organizations

You must keep your account secure and are responsible for activity under organizations you own or administer. Organization owners are responsible for their members.

## Plans and billing

Polar is rdyrct's merchant of record for paid plans. Subscriptions renew until you cancel them, and you can manage them in Billing. rdyrct is MIT licensed and can be self-hosted from the [public repository](https://github.com/baronunread/rdyrct). Hosted-service terms do not apply to a self-hosted installation.

Links keep redirecting however many clicks they get. Each plan records a set number of clicks a month for each organization (5,000 on Free, 50,000 on Hobby, 500,000 on Pro). Past that, the rest of that month's clicks are not recorded for analytics; the links themselves keep working.

## Service, termination, and law

rdyrct is provided as is and as available, without warranties. You may stop using it and delete your account at any time. We may suspend or terminate accounts that break these terms. Italian law governs these terms, without limiting mandatory consumer rights in your country.

## Changes and contact

We may update these terms. Continuing to use rdyrct after a change takes effect accepts the revised terms. Email [support@mail.rdyrct.com](mailto:support@mail.rdyrct.com) with questions.`,
  },
} satisfies Record<string, PageMeta>;
