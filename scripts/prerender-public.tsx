/**
 * Render the public entry pages into the built shell. The browser hydrates
 * these exact route trees, while every other route keeps the client shell.
 *
 *   bun scripts/prerender-public.tsx   (run by `bun run build`)
 */
import { mkdir, rm } from "node:fs/promises";
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

type ManifestChunk = { file: string; css?: string[]; imports?: string[] };
const manifestPath = `${dir}/.vite/manifest.json`;
const manifest: Record<string, ManifestChunk> = await Bun.file(manifestPath).json();
// Read once, and gone before anything can fail: dist/ is served as is.
await rm(manifestPath);

/** Preload tags for a route's chunks. Without them the browser learns about
 *  the route only after the entry runs its import(), one round trip late. */
function preloadTags(source: string) {
  const chunk = manifest[source];
  if (!chunk) throw new Error(`${source} is not in the build manifest`);
  const files = [chunk.file, ...(chunk.imports ?? []).map((key) => manifest[key].file)];
  return [
    ...files.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`),
    ...(chunk.css ?? []).map((f) => `<link rel="stylesheet" crossorigin href="/${f}">`),
  ].join("");
}

const ROUTE_SOURCES = new Map([
  ["/", "src/app/routes/landing.tsx"],
  ["/pricing", "src/app/routes/pricing.tsx"],
  ["/qr-code-generator", "src/app/routes/qr-generator.tsx"],
  ["/docs", "src/app/routes/docs.tsx"],
  ["/roadmap", "src/app/routes/roadmap.tsx"],
  ["/privacy", "src/app/routes/privacy.tsx"],
  ["/terms", "src/app/routes/terms.tsx"],
]);

for (const path of PRERENDER_ROUTES) {
  await preparePublicPage(path);
  const markup = await renderApp();
  const source = ROUTE_SOURCES.get(path);
  if (!source) throw new Error(`${path} has no entry in ROUTE_SOURCES`);

  const page = await new HTMLRewriter()
    .on("#root", {
      element(element) {
        element.setAttribute("data-prerendered", path);
        element.setInnerContent(markup, { html: true });
      },
    })
    .on("head", {
      element(head) {
        head.append(preloadTags(source), { html: true });
      },
    })
    .transform(new Response(shell))
    .text();

  const file = path === "/" ? `${dir}/index.html` : `${dir}/_prerendered${path}.txt`;
  await mkdir(path === "/" ? dir : `${dir}/_prerendered`, { recursive: true });
  await Bun.write(file, page);
  console.log(`prerendered ${file}`);
}
