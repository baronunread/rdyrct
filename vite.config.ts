import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { devHostVars } from "./scripts/dev-host-keys";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { siteHead } from "./scripts/site-head";
import { isRdyrctSite } from "./scripts/site-mode";

const SITE = isRdyrctSite();

const SITE_DEFINE = { "import.meta.env.VITE_RDYRCT_SITE": JSON.stringify(SITE ? "1" : "0") };

/** Mono 700 loads normally: it appears below the fold, and preloading an unpainted weight competes for the same connection. */
const PRELOAD_FONTS = [
  ["@fontsource-variable/figtree", "figtree-latin-wght-normal.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
] as const;

/**
 * index.html is static and the app is client-rendered, so a <link> from React would land only after the JS ran.
 * Emitting the font files here and writing the href into the HTML lets the preload scanner find it.
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

/** Runs first, so the font preloads land in what is left. */
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

/** Dropping the call in main.tsx alone is not enough: the bundler still emits a chunk for every import() it saw. */
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
      // Short-lived in-memory bindings, never a developer's persisted D1, KV or R2 state.
      persistState: process.env.PLAYWRIGHT_TEST ? false : true,
      inspectorPort: process.env.PLAYWRIGHT_TEST ? false : undefined,
      // .dev.vars must not set the addresses `bun run dev` hands over (it would win).
      config: devHostVars(process.env),
    }),
  ],
  define: SITE_DEFINE,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // qrcode's "browser" field remaps its main entry to a canvas build with no toBuffer; the Worker needs the
      // pure-JS server build (#139). Aliasing the bare specifier forces it and keeps the @types.
      qrcode: fileURLToPath(new URL("./node_modules/qrcode/lib/server.js", import.meta.url)),
    },
  },
  // Dev-only: lets curl -H "Host: linker.example.com" exercise the custom-domain path.
  // `true as const`: the async config factory widens it to boolean, and Vite only accepts `true | string[]`.
  server: { allowedHosts: true as const },
  // scripts/prerender-public.tsx reads the manifest to preload the landing
  // route's chunks, which only the entry's dynamic import() names otherwise.
  build: {
    manifest: true,
    sourcemap: process.env.POSTHOG_SOURCEMAPS === "1" ? "hidden" : false,
  },
}));
