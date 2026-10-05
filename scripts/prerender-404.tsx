/**
 * Renders the app's 404 (NotFoundView) into the built index.html once, at
 * build time, as dist/client/404-short.html: the page rdyr.cc and custom
 * domains answer a dead link with (src/worker/not-found-page.ts).
 *
 * Done here rather than in the Worker so React's server renderer stays out
 * of the Worker bundle and no 404 renders anything at request time. The
 * page keeps the shell's stylesheet, font preloads and theme script, and
 * loses the app's scripts: the app must not boot on a redirect-only host.
 *
 *   bun scripts/prerender-404.tsx   (run by `bun run build`)
 */
import { renderToStaticMarkup } from "react-dom/server";
import { NotFoundView } from "../src/app/components/not-found-view";

const dir = "dist/client";
const shell = await Bun.file(`${dir}/index.html`).text();
// The Worker points this at APP_URL, or removes it on a custom domain.
const markup = renderToStaticMarkup(<NotFoundView back={<a href="/">Go home</a>} />);

const page = new HTMLRewriter()
  .on("#root", { element: (e) => void e.setInnerContent(markup, { html: true }) })
  .on("title", { element: (e) => void e.setInnerContent("Not found") })
  .on("body", { element: (e) => void e.setAttribute("data-page", "404-short") })
  .on('script[type="module"]', { element: (e) => void e.remove() })
  .on('link[rel="modulepreload"]', { element: (e) => void e.remove() })
  // Analytics would count a dead link on our numbers.
  .on("script[src]", { element: (e) => void e.remove() })
  .transform(shell);

await Bun.write(`${dir}/404-short.html`, page);
console.log(`prerendered ${dir}/404-short.html`);
