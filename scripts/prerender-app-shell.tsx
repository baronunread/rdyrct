/**
 * Renders the app's shell into the built index.html per app page (src/shared/app-shell.ts) so
 * a reload paints the sidebar at once. Hidden unless html[data-auth="in"], so signed-out visitors never see it.
 * Runs before prerender-public.tsx, which deletes the build manifest this reads.
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
