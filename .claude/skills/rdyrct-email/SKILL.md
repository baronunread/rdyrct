# Skill: rdyrct-email

Build and preview email for this repo. `AGENTS.md` owns how the project works
and `rdyrct-design` owns how everything looks; this covers the one surface that
renders nowhere near a browser: mail.

## Where email lives

- `src/worker/email-layout.ts` is the only layout. `renderEmail()` turns one
  `EmailContent` object into both parts (HTML + plain text). Do not write a
  second layout, and do not inline raw HTML into a route.
- `src/worker/email-html.ts` is the escaping layer. Interpolate with the
  `emailHtml` tag; only `SafeHtml` passes through unescaped. Any user input
  (names, org names) goes through it automatically.
- `src/worker/email.ts` is sending: `sendEmail()` over the Resend HTTP API,
  `RESEND_BASE_URL` repointed at the emulator in dev. Keep plain `fetch`; the
  Resend SDK cannot repoint its base URL, which would break the dev flow.

## Writing a new email

1. Define the content, not markup. A new email is an `EmailContent` value:
   `preheader`, `heading`, `paragraphs`, optional `blocks` (headings,
   lists, links, dividers, buttons), `code`, `cta`, `note`.
   If it does not fit those slots, extend `EmailContent` and the layout in one
   commit rather than hand-rolling HTML at the call site.
2. Copy follows the house rules: Orwell's six, no em dashes, sentence case,
   "paid" not "Pro" unless only Pro gets it. The reader is one person, not
   "our users".
3. Send it from the flow that owns the action (invite, reconcile, reset), and
   log the send, never the address, in the wide event.

## Previewing

Browser preview is the fast loop; a real inbox is the truth.

1. Write a scratch script that calls `renderEmail()` and writes `html.html` to
   a temp file, e.g. `scripts/preview-email.ts` (gitignored or deleted after):

   ```ts
   import { renderEmail } from "../src/worker/email-layout";
   import { writeFileSync } from "node:fs";
   const { html } = renderEmail({ preheader: "...", heading: "...", paragraphs: ["..."], cta: { label: "Open", url: "https://rdyrct.com" } });
   writeFileSync("/tmp/email-preview.html", html.html);
   ```

2. `bun scripts/preview-email.ts && open /tmp/email-preview.html`. Check both
   themes: your OS dark mode flips the whole design via
   `prefers-color-scheme`, so toggle appearance to see both.
3. Narrow-window check: drag the browser to ~380px. The card is `max-width:
   520px` and must stay inside the viewport without horizontal scroll.
4. For a real-inbox check, send it to yourself through the dev flow (`bun run
   dev`, read at `bun scripts/dev-hosts.ts mail`), or paste
   the HTML into Resend's Broadcast editor, which renders a preview before you
   send.

What a preview must pass before it ships: light and dark both readable, no
horizontal scroll at 380px, the preheader invisible in the body, links
http(s) only, and the footer intact (sender, recipient, "Not you?").

## Newsletters (marketing) are sent by this app, to people who opted in to that list

Transactional mail (verification codes, invites, grace warnings) is
`renderEmail()` + `sendEmail()`. A newsletter or announcement is a different
thing with a different rule, and it goes through `src/worker/newsletter.ts`.

There are two lists, and each is its own consent: **Product news** (new
features and tips) and **Offers** (deals on paid plans). An issue goes to
one of them. Pick by what the email is: anything that sells a plan, a
discount or a deadline is an offer, even inside a feature announcement.

**A verified address is not consent to marketing**, and a yes to one list is
not a yes to the other. The only people an issue may reach have opted in to
its list, and that fact lives in our own D1 (`user.news_opt_in_at` and
`user.offers_opt_in_at`, each with how: `news_opt_in_source`,
`offers_opt_in_source`), never only at a provider. The default is opted in to
neither, for existing accounts and for new ones.
`optedInRecipients(db, list, …)` in `marketing.ts` is the one query that says
who gets mail (opted in to that list, verified, not banned, inside the send's
audience filters); do not write a second, and never email an export of the user table. Mail to a person who
has not opted in is transactional or it does not go.

How it is sent:

- No subscriber list is kept at Resend. The app sends one email per user
  opted in to the issue's list through Resend's batch endpoint (up to 100 per call), over plain
  `fetch` with `RESEND_BASE_URL`, so the dev emulator receives it.
  `newsletter.ts` is the only file that knows the provider. Switching provider
  means rewriting its `postBatch` and `emailConfigured()` in `email.ts`.
- The sender is `NEWSLETTER_FROM`, on a subdomain of its own, so a marketing
  complaint cannot reach the reputation of sign-in mail. Every newsletter
  footer carries `POSTAL_ADDRESS` under the unsubscribe link, in both parts
  (CAN-SPAM). Either unset, a send or a test is refused with a 409 that
  names it.
- Every email is rendered per person with `renderEmail()` and
  `unsubscribeUrl`: the link shows in the footer of both parts, and the
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  headers (RFC 8058, which Gmail and Yahoo require of bulk mail) carry the
  same signed link. Never send a newsletter without them. The token names
  the list, so one-click takes the reader off that list only, with no page.
  Opened in a browser, the link only ever turns lists off (the email may
  have been forwarded): a ticked box for each list the reader is on, Save,
  and a smaller "Unsubscribe from all"; a list they are not on shows as off,
  with a link to Settings, where signing in turns it on. GET never changes
  anything, and a POST naming a list the reader is not on is ignored. The footer line names the list:
  "You get this because you opted in to offers from rdyrct."
- The composer is Platform > Newsletter (admin only). It takes a subject and a
  body written in Resend's editor (`@react-email/editor`, cut down in
  `routes/admin/newsletter-editor.tsx` to paragraphs, two heading sizes,
  lists, bold, italic, underline, links, line breaks, a divider and buttons),
  sends a test to the admin alone, and sends now or at a scheduled time to
  the audience above the form: a list (Product news or Offers) narrowed by
  stage (New, Active, Slipping away; defined in `marketing.ts`, from D1
  only) and plan (Free, Paid), shown as one line with the three choices
  behind Edit audience. The count updates as the filters change, and the
  send keeps the issue and its filters on its `newsletter_sends` row, so
  every batch, and a scheduled send when it goes, renders the same issue
  for the same people. The browser sends the
  editor's JSON, never HTML: `worker/newsletter-doc.ts` parses it against the
  same allow-list (anything else is a 400 naming it) into the layout's
  `blocks` slot, which escapes every string and drops any link or button that
  is not http(s). The palette and type scale stay the layout's; do not invent
  new ones. To allow another node, add it to the editor, the schema and
  `blockHtml`/`blockText` in one commit.
- One wide event per send, with the list and counts, never addresses. A
  send is a Cloudflare Workflow (`NewsletterSendWorkflow`,
  `worker/newsletter-send.ts`): it waits for the scheduled time, then goes
  batch by batch. Each batch is two steps: one picks who (Workflows keeps
  that list), one delivers exactly that list under the key
  `<sendId>-batch-<n>` after checking consent again, and moves the cursor
  past it. A retried delivery is the same list under the same key, so
  nobody gets the issue twice. Workflows caps steps per instance, so an
  audience over `MAX_BATCHES` batches is refused before it starts. A
  scheduled send can be cancelled until it begins. A send id reused with
  another subject, body or time is a 409; the composer makes a new id after
  any edit.
- The composer's Preview renders the issue through the same
  `renderIssue`/`renderEmail` path with the admin as the reader, in a
  sandboxed frame with a Light/Dark switch. Duplicate on a past or cancelled
  send loads its subject, body and audience as a new send.
- Outlook for Windows gets a 520px ghost table around the card and a VML
  button whose whole shape is the link (`email-layout.ts`).

Tests for the rule are `tests/worker/marketing.worker.ts` (only accounts
opted in to the list, verified and unbanned get mail; headers present;
non-admins get a 404; a token names its list, and tampered tokens fail) and `tests/e2e/marketing-opt-in.pw.ts`.

## Tests

`tests/email-layout.test.ts` pins the layout: both parts from one call,
preheader placement, escaping, CTA scheme checks, dark-mode block. Add a test
there for any new `EmailContent` slot, and keep the plain-text part in step
with the HTML (it is a deliverability part, not a fallback).
