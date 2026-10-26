# Changelog

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
