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
   `preheader`, `heading`, `paragraphs`, optional `code`, `cta`, `note`.
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
   dev` + `bun run mail`, read at `https://mail.rdyrct.localhost`), or paste
   the HTML into Resend's Broadcast editor, which renders a preview before you
   send.

What a preview must pass before it ships: light and dark both readable, no
horizontal scroll at 380px, the preheader invisible in the body, links
http(s) only, and the footer line intact.

## Broadcasts (marketing) go through Resend, not this repo

Transactional mail (verification codes, invites, grace warnings) is
`renderEmail()` + `sendEmail()`. Marketing announcements are a Resend
Broadcast: import contacts (the admin CSV export on /admin/users), compose in
Resend, and reuse this layout's palette and type scale if you build custom
HTML for one. The layout's tokens (LIGHT/DARK in email-layout.ts) are the
source of truth for those colours; do not invent new ones.

## Tests

`tests/email-layout.test.ts` pins the layout: both parts from one call,
preheader placement, escaping, CTA scheme checks, dark-mode block. Add a test
there for any new `EmailContent` slot, and keep the plain-text part in step
with the HTML (it is a deliverability part, not a fallback).
