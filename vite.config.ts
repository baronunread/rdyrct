import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      // Browser tests use short-lived in-memory bindings, never a developer's
      // persisted D1, KV, or R2 state.
      persistState: process.env.PLAYWRIGHT_TEST ? false : true,
      inspectorPort: process.env.PLAYWRIGHT_TEST ? false : undefined,
    }),
  ],
  resolve: {
    // mirror the tsconfig "@/*" path for runtime imports (app and worker)
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // dev-only: let curl -H "Host: linker.example.com" exercise the
  // custom-domain hot path locally
  server: { allowedHosts: true },
});
