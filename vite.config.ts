import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    // mirror the tsconfig "@/*" path for runtime imports (app and worker)
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // dev-only: let curl -H "Host: linker.example.com" exercise the
  // custom-domain hot path locally
  server: { allowedHosts: true },
});
