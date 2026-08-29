Hi, I'm baronunread, and this is my entry for the WebMCP challenge. I didn't build something new for it. I took something I already had, and handed it to the agents.

That something is rdyrct, a link shortener and QR code generator for teams. It's been live for a while. There's no new backend here, no plugin. The tools are registered right from the pages.

I'm driving this through the WebMCP Inspector. Let's start on the public site, before we go to the user dashboard.

First, let's ask the browser agent to generate a QR code for the Devpost page for this challenge.

⏸ PAUSE — fire create-QR-code in the Inspector, a real QR image comes back. Cut the entry, speed the render.

That's a WebMCP tool running on a logged-out marketing page. It generated a working code and handed back an image, and nothing left the browser. Right next to it there's a pricing tool that gives the agent the real plan numbers, so it never has to scrape the page to answer what rdyrct costs.

Now let's go to the user dashboard. This is my own organization on production, so the click numbers are small, but they're real.

Let's ask the agent to shorten the Devpost challenge page and title it WebMCP Challenge.

⏸ PAUSE — fire create-link, Links page opens with the new row. Cut and speed.

That's a real tracked link. The agent didn't fill out a form. rdyrct gave it a create-link tool, and the app jumped to the Links page on its own.

Next, let's ask it for my analytics over the last thirty days.

⏸ PAUSE — fire get-analytics, Analytics page opens, numbers render. Cut and speed.

That's the get-analytics tool. Total clicks, top links, countries, referrers, devices, and never an IP address. There are four more in the app: find-links, get-link, update-link, and delete-link. Six in total, and every one is scoped to your organization through the same API the interface uses.

All of this is registered with model context register tool, straight from React. There's no server and no plugin. If the browser supports WebMCP, the tools show up. If it doesn't, this is the same normal website it's always been.

WebMCP fits rdyrct because the work is small, and easy to say out loud. Make a link. Check how it's doing. Delete the dead ones. That's a sentence, not a dashboard you want to sit in. So now the same links and the same analytics are reachable two ways. You click when you want to look at something. You ask when you just want it done. Someone can tell their agent to clean up every link with no clicks in the last thirty days, and it'll run get-analytics, then delete-link, on their data, with their permissions.

And we didn't loosen anything to get here. Every tool that returns text is marked untrusted, so a destination URL is treated as data, not as an instruction. Writes are marked as writes. The agent gets exactly the API and the permissions a person has, nothing more.

That's the integration. An existing product, unchanged, that a browser agent can now drive, because it hands out WebMCP tools from the page.
