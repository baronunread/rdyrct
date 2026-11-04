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

## Newsletters (marketing) are sent by this app, to people who opted in

Transactional mail (verification codes, invites, grace warnings) is
`renderEmail()` + `sendEmail()`. A newsletter or announcement is a different
thing with a different rule, and it goes through `src/worker/newsletter.ts`.

**A verified address is not consent to marketing.** The only people a
newsletter may reach have opted in, and that fact lives in our own D1
(`user.marketing_opt_in_at`, with when and how: `marketing_opt_in_source`),
never only at a provider. The default is not opted in, for existing accounts
and for new ones. `optedInRecipients()` in `marketing.ts` is the one query that
says who gets mail (opted in, verified, not banned); do not write a second, and
never email an export of the user table. Mail to a person who has not opted in
is transactional or it does not go.

How it is sent:

- No subscriber list is kept at Resend. The app sends one email per opted-in
  user through Resend's batch endpoint (up to 100 per call), over plain
  `fetch` with `RESEND_BASE_URL`, so the dev emulator receives it.
  `newsletter.ts` is the only file that knows the provider. Switching provider
  means rewriting its `postBatch` and `emailConfigured()` in `email.ts`.
- The sender is `NEWSLETTER_FROM`, on a subdomain of its own, so a marketing
  complaint cannot reach the reputation of sign-in mail. Unset, a send is
  refused with an error.
- Every email is rendered per person with `renderEmail()` and
  `unsubscribeUrl`: the link shows in the footer of both parts, and the
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  headers (RFC 8058, which Gmail and Yahoo require of bulk mail) carry the
  same signed link. Never send a newsletter without them.
- The composer is Platform > Newsletter (admin only). It takes a subject and a
  body written in Resend's editor (`@react-email/editor`, cut down in
  `routes/admin/newsletter-editor.tsx` to paragraphs, two heading sizes,
  lists, bold, italic, underline, links, line breaks, a divider and buttons),
  sends a test to the admin alone, and sends to all. The browser sends the
  editor's JSON, never HTML: `worker/newsletter-doc.ts` parses it against the
  same allow-list (anything else is a 400 naming it) into the layout's
  `blocks` slot, which escapes every string and drops any link or button that
  is not http(s). The palette and type scale stay the layout's; do not invent
  new ones. To allow another node, add it to the editor, the schema and
  `blockHtml`/`blockText` in one commit.
- One wide event per send, with counts and never addresses. A send over 5,000
  recipients is refused, not cut short; past that, move it to a Workflow.

Tests for the rule are `tests/worker/marketing.worker.ts` (only opted-in,
verified, unbanned accounts get mail; headers present; non-admins get a 404;
tampered tokens fail) and `tests/e2e/marketing-opt-in.pw.ts`.

## Tests

`tests/email-layout.test.ts` pins the layout: both parts from one call,
preheader placement, escaping, CTA scheme checks, dark-mode block. Add a test
there for any new `EmailContent` slot, and keep the plain-text part in step
with the HTML (it is a deliverability part, not a fallback).
