import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

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

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    preloadFonts(),
    cloudflare({
      // Browser tests use short-lived in-memory bindings, never a developer's
      // persisted D1, KV, or R2 state.
      persistState: process.env.PLAYWRIGHT_TEST ? false : true,
      inspectorPort: process.env.PLAYWRIGHT_TEST ? false : undefined,
    }),
  ],
  resolve: {
    // mirror the tsconfig "@/*" path for runtime imports (app and worker)
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // capjs-core reaches for these two only in its instrumentation mode,
      // which we do not use. Left alone, the bundler follows the dynamic
      // imports and ships a 5 MB javascript-obfuscator chunk in the Worker.
      // See src/worker/cap-unused-dep-stub.ts.
      esbuild: fileURLToPath(new URL("./src/worker/cap-unused-dep-stub.ts", import.meta.url)),
      "javascript-obfuscator": fileURLToPath(
        new URL("./src/worker/cap-unused-dep-stub.ts", import.meta.url),
      ),
    },
  },
  // dev-only: let curl -H "Host: linker.example.com" exercise the
  // custom-domain hot path locally
  // `true as const`: the async config factory widens it to boolean otherwise,
  // and Vite's type only accepts `true | string[]`.
  server: { allowedHosts: true as const },
}));
