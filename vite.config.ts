import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

const PRELOAD_FONTS = [
  "jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-latin-700-normal.woff2",
];

/**
 * Preloads the two above-the-fold JetBrains Mono weights (latin subset) as a
 * real <link> in index.html. index.html is static, so it can't run the `?url`
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
    name: "preload-jetbrains-mono",
    config(_config, { command }) {
      isServe = command === "serve";
    },
    buildStart() {
      if (isServe) return;
      for (const file of PRELOAD_FONTS) {
        const filePath = fileURLToPath(
          import.meta.resolve(`@fontsource/jetbrains-mono/files/${file}`),
        );
        const refId = this.emitFile({ type: "asset", name: file, source: readFileSync(filePath) });
        fileNames.set(file, this.getFileName(refId));
      }
    },
    transformIndexHtml() {
      const hrefs = isServe
        ? PRELOAD_FONTS.map((file) => `/node_modules/@fontsource/jetbrains-mono/files/${file}`)
        : PRELOAD_FONTS.map((file) => `/${fileNames.get(file)}`);
      return hrefs.map((href) => ({
        tag: "link",
        injectTo: "head-prepend" as const,
        attrs: { rel: "preload", href, as: "font", type: "font/woff2", crossorigin: true },
      }));
    },
  };
}

/**
 * Last known star count, baked in at build time.
 *
 * The strict CSP blocks the browser from calling api.github.com, and adding
 * it to connect-src to display one integer is not a trade worth making. So
 * the number is resolved here and inlined. If GitHub is unreachable or rate
 * limits us, the build keeps the committed fallback rather than failing:
 * a stale star count is worth less than a red CI run.
 */
const GITHUB_STARS_FALLBACK = 34;

async function githubStars(): Promise<number> {
  try {
    const res = await fetch("https://api.github.com/repos/baronunread/rdyrct", {
      headers: { accept: "application/vnd.github+json", "user-agent": "rdyrct-build" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return GITHUB_STARS_FALLBACK;
    // SAFETY: the field is read back through Number.isFinite below, so a
    // response without it, or with something else in it, falls back.
    const body = (await res.json()) as { stargazers_count?: number };
    const stars = Number(body.stargazers_count);
    return Number.isFinite(stars) ? stars : GITHUB_STARS_FALLBACK;
  } catch {
    return GITHUB_STARS_FALLBACK;
  }
}

export default defineConfig(async () => ({
  define: { __GITHUB_STARS__: JSON.stringify(await githubStars()) },
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
