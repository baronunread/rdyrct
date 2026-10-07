/**
 * Render the public entry pages into the built shell. The browser hydrates
 * these exact route trees, while every other route keeps the client shell.
 *
 *   bun scripts/prerender-public.tsx   (run by `bun run build`)
 */
import { mkdir } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { App, PRERENDER_ROUTES, preparePublicPage } from "../src/app/main";

const dir = "dist/client";
const shell = await Bun.file(`${dir}/index.html`).text();

function renderApp() {
  return new Promise<string>((resolve, reject) => {
    const stream = new PassThrough();
    let markup = "";
    stream.on("data", (chunk: Buffer) => {
      markup += chunk.toString();
    });
    stream.on("end", () => resolve(markup));
    stream.on("error", reject);
    const rendering = renderToPipeableStream(<App />, {
      onAllReady: () => rendering.pipe(stream),
      onShellError: reject,
      onError: reject,
    });
  });
}

for (const path of PRERENDER_ROUTES) {
  await preparePublicPage(path);
  const markup = await renderApp();

  const page = await new HTMLRewriter()
    .on("#root", {
      element(element) {
        element.setAttribute("data-prerendered", path);
        element.setInnerContent(markup, { html: true });
      },
    })
    .transform(new Response(shell))
    .text();

  const file = path === "/" ? `${dir}/index.html` : `${dir}/_prerendered${path}.txt`;
  await mkdir(path === "/" ? dir : `${dir}/_prerendered`, { recursive: true });
  await Bun.write(file, page);
  console.log(`prerendered ${file}`);
}
