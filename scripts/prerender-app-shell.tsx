/**
 * Renders the app's shell, the sidebar and each page's skeleton, into the
 * built index.html once per app page (src/shared/app-shell.ts), so a reload
 * of /dashboard paints the sidebar from the first byte instead of after the
 * bundle has loaded and run:
 *
 *   dist/client/_app-shell/<page>.txt
 *
 * The Worker answers a reload of that page with it (src/worker/index.ts).
 * The markup is AppShellSkeleton itself, the component React paints first,
 * so when the bundle mounts and replaces it nothing moves.
 *
 * It is hidden unless the head script in index.html found a cached session
 * (html[data-auth="in"]), so a signed-out visitor never sees a sidebar on
 * the way to the login page. Both sidebar widths are in the page and the
 * head script shows the stored one. Where the org and the person go it
 * leaves slots (ShellSlots), which styles.css fills from CSS variables the
 * same script sets from the cache.
 *
 * Runs before prerender-public.tsx, which bakes the landing page into
 * index.html and deletes the build manifest this reads.
 *
 *   bun scripts/prerender-app-shell.tsx   (run by `bun run build`)
 */
import { mkdir } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShellSkeleton } from "../src/app/components/skeletons";
import { ShellSlots } from "../src/app/components/shell-slots";
import { APP_SHELL_PAGES } from "../src/shared/app-shell";

const dir = "dist/client";
const shell = await Bun.file(`${dir}/index.html`).text();

type ManifestChunk = { file: string; imports?: string[] };
const manifest: Record<string, ManifestChunk> = await Bun.file(`${dir}/.vite/manifest.json`).json();

/** The shell's own code, preloaded: the page is already drawn, and this is
 *  what takes it over. */
function shellPreloads(): string {
  const chunk = manifest["src/app/routes/shell.tsx"];
  if (!chunk) throw new Error("src/app/routes/shell.tsx is not in the build manifest");
  const files = [chunk.file, ...(chunk.imports ?? []).map((key) => manifest[key].file)];
  return files.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`).join("");
}

function Shell() {
  return (
    <ShellSlots.Provider value>
      <div data-shell-static="">
        <div data-shell-width="open">
          <AppShellSkeleton folded={false} />
        </div>
        <div data-shell-width="folded">
          <AppShellSkeleton folded />
        </div>
      </div>
    </ShellSlots.Provider>
  );
}

async function render(path: string): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute({ component: Shell }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

await mkdir(`${dir}/_app-shell`, { recursive: true });
const preloads = shellPreloads();

for (const [name, path] of Object.entries(APP_SHELL_PAGES)) {
  // The tests find the client's skeleton by its test id; this copy is not it.
  const markup = (await render(path)).replace(/ data-testid="[^"]*"/g, "");
  const page = new HTMLRewriter()
    .on("#root", { element: (e) => void e.setInnerContent(markup, { html: true }) })
    .on("head", { element: (e) => void e.append(preloads, { html: true }) })
    .transform(shell);
  await Bun.write(`${dir}/_app-shell/${name}.txt`, page);
  console.log(`prerendered ${dir}/_app-shell/${name}.txt`);
}
