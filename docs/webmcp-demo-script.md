▶ One continuous teleprompter scroll. Never pause it (Cap resets to the top).
At each GAP: stop talking, run the tool call, keep your eyes on the page.
The blank runway keeps the scroll drifting so you land on the next line
when you resume. Cut the dead silence in the edit, and speed or jump-cut
anything that shows a prompt being typed or text streaming in.

---

I'm baronunread. This is my WebMCP entry. I didn't build a new app for it. I took rdyrct, a link shortener and QR generator my team already uses, and gave it to browser agents.

Nothing changed underneath. No new backend, no plugin. Each page registers its own WebMCP tools.

I'm driving it from ChatGPT, in cowork mode. ChatGPT reads the page and calls the tools it finds there.

We're not signed in, and we don't need to be yet. The marketing pages bring their own tools. So first, let's ask what rdyrct costs.

          - - - - - GAP: get_rdyrct_pricing runs on the logged-out page. Stay
          silent. ChatGPT answers with the real plans and limits. Resume when
          the answer is on screen. - - - - -

No account, no scraping. The page handed ChatGPT the real plan numbers. Now let's have it make something. A QR code for the Devpost page.

          - - - - - GAP: create_qr_code fires on the logged-out page. Stay
          silent. A QR code comes back as an image. If it retries once, let
          it, that's fine. Resume when the code is on screen. - - - - -

There it is, a real QR code as an image, still no account. And if I want to style it, I ask ChatGPT to open the generator and make it green.

          - - - - - GAP: ChatGPT navigates to the QR generator on its own,
          then calls generate_qr_code. Stay silent. The value and the color
          fill into the fields, the preview updates. Resume when it does. - - - - -

Same tools, one page over. ChatGPT walked onto the generator, typed the value and the color into the fields, and the code redrew. Everything so far, without signing in.

          - - - - - GAP: sign in to rdyrct in the cloud browser now. Cut this
          whole stretch from the video. Resume once the dashboard has loaded
          and you're signed in. - - - - -

Signed in now, so the app's tools come into play too. This is my own organization on production, so the click numbers you'll see are small, but they're real.

Let's ask ChatGPT to shorten the Devpost page and title it WebMCP Challenge.

          - - - - - GAP: create_link runs. Stay silent. The Links page opens
          with the new row. Resume when it shows. - - - - -

A real tracked link. ChatGPT didn't fill out a form. rdyrct gave it a create-link tool, and the app jumped to the Links page on its own.

Next, let's ask it for my analytics over the last thirty days, and which links are dead.

          - - - - - GAP: get_analytics runs, link_health focus. Stay silent.
          The Analytics page opens, and ChatGPT reads back the no-click links.
          Resume when it does. - - - - -

Total clicks, top links, countries, referrers, devices, and never an IP address, plus the links that haven't been clicked. So let's ask it to find one of those and get rid of it.

          - - - - - GAP: find_links searches, then delete_link removes the one
          I name. Stay silent. The Links page updates without that row. Resume
          when it's gone. - - - - -

Searched by name, deleted by slug, and the short link stops redirecting.

So that's rdyrct with WebMCP. Same product, same permissions, but every one of those tools is also a sentence you can say to an agent. Nine tools, registered straight from the pages, no new backend.

Thanks for watching.
