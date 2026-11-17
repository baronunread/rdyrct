/**
 * Renders the pages a short link answers with when it does not redirect (404-short, link-held,
 * link-disabled, link-warn) into the built index.html once. Done here, not in the Worker, so
 * React's server renderer stays out of the bundle and the app does not boot on a redirect-only host.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DISABLED_PAGE, HELD_PAGE, WARN_PAGE } from "../src/shared/link-pages";
import { HOME_LINK } from "../src/app/components/not-found-home";
import { NotFoundView } from "../src/app/components/not-found-view";
import { DisabledView, HeldView, WarnView } from "../src/app/components/link-state-views";

const dir = "dist/client";
const shell = await Bun.file(`${dir}/index.html`).text();

const pages: { name: string; title: string; view: ReactElement }[] = [
  {
    name: "404-short",
    title: "Not found",
    // The Worker points this at APP_URL, or removes it on a custom domain.
    view: (
      <NotFoundView
        madeWith
        back={
          <a href="/" className={HOME_LINK}>
            Go home
          </a>
        }
      />
    ),
  },
  { name: "link-held", title: HELD_PAGE.title, view: <HeldView /> },
  { name: "link-disabled", title: DISABLED_PAGE.title, view: <DisabledView /> },
  { name: "link-warn", title: WARN_PAGE.title, view: <WarnView /> },
];

for (const { name, title, view } of pages) {
  const markup = renderToStaticMarkup(view);
  const page = new HTMLRewriter()
    .on("#root", { element: (e) => void e.setInnerContent(markup, { html: true }) })
    .on("title", { element: (e) => void e.setInnerContent(title) })
    .on("body", { element: (e) => void e.setAttribute("data-page", name) })
    .on('script[type="module"]', { element: (e) => void e.remove() })
    .on('link[rel="modulepreload"]', { element: (e) => void e.remove() })
    // Analytics would count a dead or held link on our numbers.
    .on("script[src]", { element: (e) => void e.remove() })
    // The landing page's description, canonical, share cards and structured
    // data: on a dead, held or warned link they would describe rdyrct.com,
    // and on a customer's domain they would claim the page is ours.
    .on('meta[name="description"]', { element: (e) => void e.remove() })
    .on('link[rel="canonical"]', { element: (e) => void e.remove() })
    .on('meta[property^="og:"]', { element: (e) => void e.remove() })
    .on('meta[name^="twitter:"]', { element: (e) => void e.remove() })
    .on('script[type="application/ld+json"]', { element: (e) => void e.remove() })
    .transform(shell);

  await Bun.write(`${dir}/${name}.html`, page);
  console.log(`prerendered ${dir}/${name}.html`);
}
