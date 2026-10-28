import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEV_DEFAULT_KEYS, DEV_HOST_KEYS } from "./scripts/dev-host-keys";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { siteHead } from "./scripts/site-head";
import { isRdyrctSite } from "./scripts/site-mode";

/** rdyrct.com, or a self-hosted copy (scripts/site-mode.ts). */
const SITE = isRdyrctSite();

/** What src/shared/site.ts reads, worked out above rather than left to
 *  whoever runs the build. A literal, so the bundler drops what it guards. */
const SITE_DEFINE = { "import.meta.env.VITE_RDYRCT_SITE": JSON.stringify(SITE ? "1" : "0") };

/**
 * The faces above the fold, as `[package, file]`.
 *
 * Figtree is the variable cut, so one file covers every weight the page
 * paints. JetBrains Mono 400 carries the slugs. Mono 700 loads normally: it
 * appears below the fold, and preloading a weight that isn't painted
 * immediately just competes for the same connection as the ones that are.
 */
const PRELOAD_FONTS = [
  ["@fontsource-variable/figtree", "figtree-latin-wght-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
] as const;

/**
 * Preloads the above-the-fold faces (latin subset) as a real <link> in
 * index.html. index.html is static, so it can't run the `?url`
 * import Fontsource's own docs recommend, and rendering the <link> from React
 * doesn't help either: this app is client-rendered, so the tag would only
 * land in <head> once the same JS that triggers the real paint has already
 * run. Emitting the font files through Vite's asset pipeline here and writing
 * the resolved href straight into the HTML makes the browser's preload
 * scanner discover it while parsing the initial HTML, before the JS bundle
 * even finishes loading.
 */
function preloadFonts(): Plugin {
  let isServe = false;
  const fileNames = new Map<string, string>();

  return {
    name: "preload-fonts",
    config(_config, { command }) {
      isServe = command === "serve";
    },
    buildStart() {
      if (isServe) return;
      for (const [pkg, file] of PRELOAD_FONTS) {
        const filePath = fileURLToPath(import.meta.resolve(`${pkg}/files/${file}`));
        const refId = this.emitFile({ type: "asset", name: file, source: readFileSync(filePath) });
        fileNames.set(file, this.getFileName(refId));
      }
    },
    transformIndexHtml() {
      const hrefs = isServe
        ? PRELOAD_FONTS.map(([pkg, file]) => `/node_modules/${pkg}/files/${file}`)
        : PRELOAD_FONTS.map(([, file]) => `/${fileNames.get(file)}`);
      return hrefs.map((href) => ({
        tag: "link",
        injectTo: "head-prepend" as const,
        attrs: { rel: "preload", href, as: "font", type: "font/woff2", crossorigin: true },
      }));
    },
  };
}

/** Drops rdyrct.com's own head tags from any build that is not rdyrct.com
 *  (scripts/site-head.ts). Runs first, so the font preloads land in what is
 *  left. */
function rdyrctSiteHead(): Plugin {
  return {
    name: "rdyrct-site-head",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => siteHead(html, SITE),
    },
  };
}

const NO_MARKETING = "\0no-marketing-routes";

/**
 * Leaves rdyrct.com's pages out of a self-hosted build at the source: the
 * import of src/app/marketing-routes.tsx resolves to an empty module, so
 * nothing it reaches (landing, pricing, docs, legal pages, the marketing
 * header and footer) is bundled. Dropping the call in main.tsx alone is not
 * enough, because the bundler still emits a chunk for every import() it saw.
 */
function selfHostPages(): Plugin {
  return {
    name: "self-host-pages",
    enforce: "pre",
    resolveId: (id) => (!SITE && id === "./marketing-routes" ? NO_MARKETING : null),
    load: (id) =>
      id === NO_MARKETING
        ? "export function marketingRoutes() { throw new Error('rdyrct.com only'); }"
        : null,
  };
}

export default defineConfig(async (): Promise<UserConfig> => ({
  plugins: [
    react(),
    tailwindcss(),
    rdyrctSiteHead(),
    selfHostPages(),
    preloadFonts(),
    cloudflare({
      // Browser tests use short-lived in-memory bindings, never a developer's
      // persisted D1, KV, or R2 state.
      persistState: process.env.PLAYWRIGHT_TEST ? false : true,
      inspectorPort: process.env.PLAYWRIGHT_TEST ? false : undefined,
      // `bun run dev` (scripts/dev.ts) works out this checkout's addresses
      // and hands them over here; .dev.vars must not set them (it would win).
      config: process.env.RDYRCT_DEV_HOSTS
        ? {
            vars: Object.fromEntries([
              ...DEV_HOST_KEYS.map((key) => [key, process.env[key] ?? ""]),
              ...DEV_DEFAULT_KEYS.flatMap((key) =>
                process.env[key] ? [[key, process.env[key]]] : [],
              ),
            ]),
          }
        : undefined,
    }),
  ],
  define: SITE_DEFINE,
  resolve: {
    // mirror the tsconfig "@/*" path for runtime imports (app and worker)
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // qrcode's package.json "browser" field remaps its own main entry to a
      // canvas/document-based build with no toBuffer, and no DOM to draw
      // into anyway; the Worker always wants the pure-JS server build (#139,
      // generate_qr_code). Aliasing the bare specifier keeps `import ...
      // from "qrcode"` and its @types intact while forcing that resolution.
      qrcode: fileURLToPath(new URL("./node_modules/qrcode/lib/server.js", import.meta.url)),
    },
  },
  // dev-only: let curl -H "Host: linker.example.com" exercise the
  // custom-domain hot path locally
  // `true as const`: the async config factory widens it to boolean otherwise,
  // and Vite's type only accepts `true | string[]`.
  server: { allowedHosts: true as const },
  // scripts/prerender-public.tsx reads the manifest to preload the landing
  // route's chunks, which only the entry's dynamic import() names otherwise.
  build: {
    manifest: true,
    // Only release builds need maps. The upload command removes them before
    // deployment; ordinary builds and browser checks need no PostHog access.
    sourcemap: process.env.POSTHOG_SOURCEMAPS === "1" ? "hidden" : false,
  },
}));
