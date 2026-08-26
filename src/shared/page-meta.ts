/**
 * What each public page calls itself in a search result and a link preview.
 *
 * Shared because two places need the same strings and must not drift: the
 * Worker writes them into the HTML it serves (src/worker/page-meta.ts), and
 * the SPA re-applies them on client-side navigation, where no new document is
 * fetched and the head would otherwise still describe the page somebody
 * arrived on.
 *
 * The wording leads with what people type. "URL shortener" and "QR code
 * generator" are the searches; the brand is not, and a title that opens with
 * it spends the most valuable words in the result on a name nobody is looking
 * for yet.
 */
export interface PageMeta {
  title: string;
  description: string;
  /** A hand-written representation for clients that prefer Markdown. */
  markdown?: string;
}

/**
 * What index.html ships, and therefore what every page that has no entry of
 * its own should read. Kept here rather than left implicit in the HTML: the
 * client hook has to put this back when it leaves a public page, and
 * "restore whatever the document arrived with" is wrong for exactly the
 * visitor who arrived on the public page itself.
 */
export const DEFAULT_PAGE_META: PageMeta = {
  title: "Free URL shortener and QR code generator - rdyrct",
  description:
    "Free URL shortener and QR code generator for teams: branded short links on your own domain, custom QR codes, and privacy-friendly click analytics.",
};

export const PUBLIC_PAGE_META = {
  "/": {
    title: "Free URL shortener and QR code generator - rdyrct",
    description:
      "Free URL shortener and QR code generator for teams: branded short links on your own domain, custom QR codes, and privacy-friendly click analytics.",
    markdown: `# rdyrct

rdyrct is a free URL shortener and QR code generator for teams. Create short links on a domain people recognise, make branded QR codes, and see privacy-friendly click analytics.

## What you can do

- Shorten a link without an account, then sign up to manage it.
- Use a custom domain for links whose slug you choose.
- Make QR codes with a logo, colours, rounded dots, and PNG or SVG downloads.
- See click country, referrer, device type, and time. rdyrct never stores an IP address.

## Getting started

[Create a free account](/signup) or [compare plans](/pricing). You can also [self-host rdyrct on Cloudflare](https://github.com/baronunread/rdyrct).`,
  },
  "/qr-code-generator": {
    title: "Free QR code generator with logo - PNG and SVG, no account",
    description:
      "Make a custom QR code online for free: your logo in the middle, your colors, rounded dots, and a PNG or SVG download. No sign-up, no watermark, and the code is generated in your browser.",
    markdown: `# Free QR code generator

Make a QR code for a link, text, Wi-Fi details, or any other string. Add a logo, choose colours and dot styles, then download a PNG or SVG.

No account, watermark, or expiry is required. The code is generated in your browser, and rdyrct does not store what you enter.

[Open the QR code generator](/qr-code-generator)`,
  },
  "/pricing": {
    title: "Pricing - rdyrct URL shortener and QR codes",
    description:
      "Free, Hobby and Pro plans for rdyrct: short links, custom domains, branded QR codes and click analytics. Start free, or self-host on your own Cloudflare account.",
    markdown: `# rdyrct pricing

rdyrct is an organization-based link shortener and QR code generator that runs entirely on Cloudflare.

## Free: $0/month

- 30 links
- 3 team members
- 7-day click analytics
- Plain QR codes
- Random slugs on the shared domain
- 1 organization

[Sign up free](/signup)

## Hobby: $4/month

- 500 links
- 5 team members
- 30-day click analytics
- QR codes with a logo, colours, and dot styles
- 1 custom domain, with any slug you choose
- 1 organization

[Start Hobby](/signup?next=%2Fbilling%3Fplan%3Dhobby)

## Pro: $9/month

- 3,000 links
- 25 team members
- 365-day click analytics
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
- Slugs on rdyrct.com are always random. Choosing a slug needs a custom domain.
- Click analytics never store an IP address.`,
  },
  "/roadmap": {
    title: "Roadmap - rdyrct URL shortener",
    description:
      "What rdyrct is building next: a public REST API, API keys, an OpenAPI document, and an MCP server for agents. Every item is an open issue you can read and comment on.",
    markdown: undefined,
  },
  "/signup": {
    title: "Sign up - rdyrct URL shortener and QR codes",
    description:
      "Create a free rdyrct account: short links with click analytics, QR codes, and UTM tracking for your team. No card required.",
    markdown: undefined,
  },
  "/login": {
    title: "Log in - rdyrct",
    description: "Log in to your rdyrct account to manage short links, QR codes and analytics.",
    markdown: undefined,
  },
  "/privacy": {
    title: "Privacy policy - rdyrct",
    description:
      "What rdyrct stores and what it does not: click analytics keep country, referrer, device and time, never an IP address or a precise location.",
    markdown: `# Privacy policy

This policy explains what rdyrct collects, why, the legal basis for it, and how you can exercise your rights. Last updated 25 August 2026.

## Data controller

Andrea Bruno is the data controller for rdyrct. For a privacy request or question, email [support@rdyrct.com](mailto:support@rdyrct.com).

## Data we collect

We collect your account email address and name, plus the organizations, links, domains, and settings you create. Click analytics keep only an approximate country, referrer host, device type, and timestamp. We do not store an IP address, precise location, or data that enables cross-site tracking.

If you accept analytics, PostHog records product events tied to your account. It does not autocapture what you type or replay your screen. Sentry receives technical error reports with the error, browser, and page path, after query strings are removed.

## Why we process it

We process account and organization data to provide the service, send transactional email, and provide click analytics. The session cookie is necessary to sign you in. PostHog runs only with your consent. We process technical error reports to keep the service secure and reliable.

## Cookies

rdyrct sets a necessary session cookie. If you accept analytics, PostHog also sets a cookie. We do not use advertising cookies.

## Sub-processors

We use Cloudflare for hosting and storage, Resend for transactional email, Polar for billing, PostHog EU for product analytics, and Sentry for error monitoring.

## Retention and rights

We retain account and organization data while your account is active. You can access, correct, export, or erase your data, object to or restrict processing, withdraw consent, or delete your account in Settings. If you are in the EU, you may complain to the Italian data protection authority.

For help, email [support@rdyrct.com](mailto:support@rdyrct.com).`,
  },
  "/terms": {
    title: "Terms of service - rdyrct",
    description: "The terms covering rdyrct short links, QR codes and analytics.",
    markdown: `# Terms of service

These terms govern your use of rdyrct. By creating an account or using the service, you agree to them. Last updated 19 July 2026.

## Acceptance and acceptable use

Use rdyrct only if you agree to these terms. Do not create links that are illegal, malicious, used for phishing, malware distribution, spam, or other abuse. We may disable a link or account that breaks this rule.

## Accounts and organizations

You must keep your account secure and are responsible for activity under organizations you own or administer. Organization owners are responsible for their members.

## Plans and billing

Polar is rdyrct's merchant of record for paid plans. Subscriptions renew until you cancel them, and you can manage them in Billing. rdyrct is MIT licensed and can be self-hosted from the [public repository](https://github.com/baronunread/rdyrct). Hosted-service terms do not apply to a self-hosted installation.

## Service, termination, and law

rdyrct is provided as is and as available, without warranties. You may stop using it and delete your account at any time. We may suspend or terminate accounts that break these terms. Italian law governs these terms, without limiting mandatory consumer rights in your country.

## Changes and contact

We may update these terms. Continuing to use rdyrct after a change takes effect accepts the revised terms. Email [support@rdyrct.com](mailto:support@rdyrct.com) with questions.`,
  },
} satisfies Record<string, PageMeta>;
