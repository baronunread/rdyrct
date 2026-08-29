▶ One continuous teleprompter scroll. Never pause it (Cap resets to the top).
At each GAP: stop talking, run the tool call, keep your eyes on the page.
The blank runway keeps the scroll drifting so you land on the next line
when you resume. Cut the dead silence in the edit, and speed or jump-cut
anything that shows a prompt being typed or text streaming in.

---

Hi, I'm baronunread, and this is my entry for the WebMCP challenge. I didn't build something new for it. I took something I already had, and handed it to the agents.

That something is rdyrct, a link shortener and QR code generator for teams. It's been live for a while. There's no new backend here, no plugin. The tools are registered right from the pages.

I'm driving this through the WebMCP Inspector. Let's start on the homepage, before we touch the dashboard.

First, let's ask the browser agent to make a QR code for the Devpost page for this challenge.

          - - - - - GAP: create_qr_code fires. Stay silent. The app leaves
          the homepage, lands on the full QR generator, the code is on
          screen. Resume when you see it. - - - - -

That one call did two things. It rendered a QR code and handed the agent an image, and it moved us to the real generator with the value filled in. That matters, because this page has its own tools.

Let's ask the agent to give the dots a dark green, and download it as an SVG.

          - - - - - GAP: generate_qr_code recolors the visible generator,
          then download_qr_code saves the SVG file. Stay silent. Resume once
          the file lands. (PNG works here too, SVG is the safe pick on camera.)
          - - - - -

So the agent walked from a public page onto the generator and drove it like a person would. Recolored it, and downloaded a file. Next to these there's also a pricing tool that hands the agent the real plan numbers, so it never scrapes the page to answer what rdyrct costs.

Now the dashboard. This is my own organization on production, so the click numbers are small, but they're real.

Let's ask the agent to shorten the Devpost challenge page and title it WebMCP Challenge.

          - - - - - GAP: create_link runs. Stay silent. The Links page
          opens with the new row. Resume when it shows. - - - - -

A real tracked link. The agent didn't fill out a form. rdyrct gave it a create-link tool, and the app jumped to the Links page on its own.

Next, let's ask it for my analytics over the last thirty days.

          - - - - - GAP: get_analytics runs. Stay silent. The Analytics
          page opens, the numbers render. Resume when they do. - - - - -

Total clicks, top links, countries, referrers, devices, and never an IP address. There are four more tools in the app: find-links, get-link, update-link, and delete-link. Every one is scoped to your organization through the same API the interface uses.

All of this is registered with model context register tool, straight from React. If the browser supports WebMCP, the tools show up. If it doesn't, this is the same normal website it's always been.

WebMCP fits rdyrct because the work is small, and easy to say out loud. Make a link. Check how it's doing. Delete the dead ones. That's a sentence, not a dashboard you want to sit in. So now the same links and the same analytics are reachable two ways. You click when you want to look at something. You ask when you just want it done. Someone can tell their agent to clean up every link with no clicks in the last thirty days, and it'll run get-analytics, then delete-link, on their data, with their permissions.

And we didn't loosen anything to get here. Every tool that returns text is marked untrusted, so a destination URL is treated as data, not as an instruction. Writes are marked as writes. The agent gets exactly the API and the permissions a person has, nothing more.

That's the integration. An existing product, unchanged, that a browser agent can now drive, because it hands out WebMCP tools from the page.
