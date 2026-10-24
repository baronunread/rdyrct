/**
 * Renders the pages a short link answers with when it does not redirect into
 * the built index.html once, at build time:
 *
 *   dist/client/404-short.html   the app's 404 (NotFoundView), for a dead link
 *   dist/client/link-held.html   "under review" (HeldView), for a held link
 *   dist/client/link-warn.html   the warning before a redirect (WarnView)
 *
 * rdyr.cc and custom domains answer with them (src/worker/not-found-page.ts,
 * src/worker/link-state-page.ts), and the app host does for the last two.
 *
 * Done here rather than in the Worker so React's server renderer stays out
 * of the Worker bundle and no page renders anything at request time. Each
 * keeps the shell's stylesheet, font preloads and theme script, and loses
 * the app's scripts: the app must not boot on a redirect-only host.
 *
 *   bun scripts/prerender-404.tsx   (run by `bun run build`)
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HELD_PAGE, WARN_PAGE } from "../src/shared/link-pages";
import { HOME_LINK } from "../src/app/components/not-found-home";
import { NotFoundView } from "../src/app/components/not-found-view";
import { HeldView, WarnView } from "../src/app/components/link-state-views";

const dir = "dist/client";
const shell = await Bun.file(`${dir}/index.html`).text();

const pages: { name: string; title: string; view: ReactElement }[] = [
  {
    name: "404-short",
    title: "Not found",
    // The Worker points this at APP_URL, or removes it on a custom domain.
    view: (
      <NotFoundView
        back={
          <a href="/" className={HOME_LINK}>
            Go home
          </a>
        }
      />
    ),
  },
  { name: "link-held", title: HELD_PAGE.title, view: <HeldView /> },
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
    .transform(shell);

  await Bun.write(`${dir}/${name}.html`, page);
  console.log(`prerendered ${dir}/${name}.html`);
}
