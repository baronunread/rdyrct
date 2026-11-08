# Changelog

## 1.2.0

A new app on every screen, a setup flow that gets a new account to its first
link, domain and team, and email that only goes to people who said yes. Banned
accounts now end cleanly, and each plan counts a set number of clicks a month
while its links keep redirecting.

### The app

- **Every screen redesigned, on desktop and phone.** The sidebar folds to an
  icon rail, Analytics is one card with tabs, and on a phone dialogs open as
  sheets from the bottom. A reload draws the sidebar from the first byte.
- **A setup flow for a new account** at `/welcome`: the org's name, a first
  link with its QR code (the card shows the first click as it lands), a
  domain, the team, and whether to hear from us. Every step can be skipped.
- **Domains in place.** Adding a domain shows its one CNAME record with a copy
  button, and a failed check can be retried instead of deleted and re-added.
- **Export an org's links as CSV.**
- Import has one row per domain and one Import button. Links on a domain that
  is still being checked import now and work once it is live.
- After a deploy, a tab left open no longer goes blank when you click into a
  page: it stays put and offers Reload. Safari users stopped seeing "Something
  broke on this page" after every deploy.

### Plans

- **Each plan records a set number of clicks a month:** Free 5,000, Hobby
  50,000, Pro 500,000. Past that, links keep redirecting; the extra clicks are
  not counted. Analytics reads daily and hourly totals, so its charts load
  faster.
- **Pro covers one organization.** You can still belong to as many orgs as
  people invite you to. Owning more than one, or any higher limit, is
  Enterprise: an admin sets custom limits for one account, and Billing shows
  them.

### Email

- **Two lists, Product news and Offers, each with its own consent.** Nobody is
  on either until they say yes: in the setup flow, in a one-time question, or
  in Settings. Every email has an unsubscribe link and one-click unsubscribe
  for mail clients.
- Admins write, test and schedule issues in Platform > Newsletter. Each send
  reads its list fresh for every batch of 100, so whoever unsubscribes during
  a send is left out.

### Abuse

- **A ban ends cleanly.** The banned account's links and domains show a page
  saying the account was suspended, its subscription is cancelled, and its
  orgs are deleted 90 days later. Unbanning before then puts every link back
  as it was.
- A held link shows a page saying it is under review instead of a 404, and
  a suspicious one shows a warning before its destination. New links are
  checked against Google Web Risk (when `WEB_RISK_API_KEY` is set), capped at
  3,000 lookups a day to stay in the free tier.
- A free org's link gets the warning only after reports from two different
  people.
- Admin usage figures leave out banned people and their orgs.

### Security

Fixes from a review before launch:

- Replaying an old checkout no longer gives back a cancelled plan.
- An email invite needs a verified address to accept, and sending the same
  invites again does not mail everyone again.
- A path with a colon cannot reach another tenant's link on a custom domain.
- One visitor flooding a link no longer drops other visitors' clicks.
- Limits on the Polar webhook's body, unsubscribe and billing reads.
- Cloudflare Turnstile replaces Cap's proof-of-work on sign-up, password reset
  and the report form.

### When you update

- Sixteen new migrations (0042 to 0057) add columns and tables. `bun run
  deploy` applies them before the new Worker goes live.
- Newsletters run in a new workflow. Add it to your `wrangler.jsonc` next to
  the others, named after your copy: binding `NEWSLETTER_SEND`, class
  `NewsletterSendWorkflow`.
- Cap is gone: delete `CAP_SECRET` and the `RL_CAP` rate limit. To keep a bot
  check on sign-up, set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; with
  neither, there is none.
- Optional: `WEB_RISK_API_KEY` for Google Web Risk. `NEWSLETTER_FROM` (a
  sender on its own subdomain) to send newsletters, with `NEWSLETTER_REPLY_TO`
  and `POSTAL_ADDRESS`. Without `NEWSLETTER_FROM`, sends are refused.
- If you merge this release's `wrangler.jsonc` into yours, delete
  `NEWSLETTER_FROM`, `NEWSLETTER_REPLY_TO` and `POSTAL_ADDRESS`: they are rdyrct.com's.

## 1.1.0

Bring your links from Bitly, Short.io, Rebrandly or Dub with their short URLs
unchanged. Your own copy now takes one command or one button, and API calls
take about half as long.

### Import from another service

- **Move your links from Short.io, Bitly, Rebrandly or Dub.** At `/import`,
  choose the service and its CSV export, and each link keeps its domain, its slug and
  where it goes, with UTM tags split out into the link's UTM fields. A file
  from any other service works too: you pick which column is which.
- A domain added from the import is checked by two TXT records, so its
  certificate is issued while it still points at the old service. Your links
  keep answering there until you change the CNAME, with no gap.
- Every row is checked before anything is written: what will import, what is
  already here, and what will not, with why.
- The import runs on the server. Once the file is sent you can close the page,
  and coming back shows how it went, with a retry for the rows that failed.
- Paid plans, since each link keeps its own slug. Clicks start from zero; the
  old service keeps their history.

### Self-hosting

- **One command for your own copy.** `bun run setup` puts it on your
  Cloudflare account. It asks for a name, a domain (or uses a workers.dev
  address) and the admin's email, then creates the database, link store, file
  storage and queues, and deploys. It refuses a name a worker on your account
  already uses.
- **The Deploy to Cloudflare button** builds a working copy.
- **Every build is a self-hosted copy** unless `VITE_RDYRCT_SITE=1` is set,
  which only rdyrct.com does. A copy opens on sign-in and carries none of
  rdyrct.com's pages, analytics or search tags. `bun run deploy` picks the
  build, and refuses a flag that does not match `APP_HOST`.
- **Tabs carry your copy's name.** Set `SITE_NAME`, or they show the host.
- No seat or link ceiling is shown where there is none.

### When you update

- Six new migrations add columns and tables and change no existing data.
  `bun run deploy` applies them.
- Imports run in a new workflow. Add it to your `wrangler.jsonc` next to the
  other two, named after your copy: binding `LINK_IMPORT`, class
  `LinkImportWorkflow`. `bun run deploy` creates it.
- A copy built without `VITE_RDYRCT_SITE=1` no longer carries rdyrct.com's
  landing page: `/` opens the app.
- If you merge this release's `wrangler.jsonc` into yours, delete
  `WELCOME_FROM` and the two `POLAR_*_YEARLY_PRODUCT_ID` values: they are
  rdyrct.com's. Left in, a copy with email set up sends its welcome email from
  our address.
- With billing on, the Polar token needs the `subscriptions:write` scope:
  deleting a paying account now cancels its subscription first, and refuses
  to delete when it cannot.

### Accounts and billing

- **Deleting a paying account cancels its Polar subscription.** Before, a
  deleted account went on being billed.
- Yearly plans, priced 10% below twelve months.
- If Polar's webhook never arrives, the billing page asks Polar whether the
  checkout went through.
- Polar webhook secrets work in both of Polar's formats.
- A welcome email after sign-up, from `WELCOME_FROM` when it is set.

### Abuse

- Anyone can report a link at `/report`. A free org's scam-shaped links
  are paused for review and the owner is told how to appeal. Admins can block
  hosts, and banning an account pauses the links in the orgs it owns.
- Admin: a toolbar on Links, a plan column, and bulk restore.

### Speed

- A signed-in API call makes one database query to check the session instead
  of three, and the Worker is 41% smaller. Most calls now take about half as
  long.

### Other

- MCP clients can register themselves (OAuth dynamic client registration),
  next to client ID metadata documents.
- Unknown paths answer 404 instead of the app's page.

## 1.0.0

First stable release. rdyrct now runs on your own Cloudflare account with
only two secrets.

### Self-hosting

- **No email provider needed.** Leave `RESEND_API_KEY` unset and sign-up signs
  people in at once, with no verification. Password reset by email is off.
  Without email or Google sign-in an instance is not secure: set one of them.
  Existing installs that have a Resend key behave as before.
- **No billing needed.** Leave `POLAR_ACCESS_TOKEN` unset and every org gets the
  "Unlimited (Selfhosted Instance)" plan. Billing pages and routes are hidden.
  **If you update an instance that never set a Polar token, its limits go away.**
- README covers the minimum setup, the optional settings, queues and the domain.
- `/admin` warns when neither email nor Google sign-in is set up.

### Other

- TanStack Charts 1.0.
