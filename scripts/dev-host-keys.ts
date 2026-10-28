/** The Worker vars that hold this checkout's dev addresses. `bun run dev`
 * (scripts/dev.ts) works them out and vite.config.ts hands them to the
 * Worker, so `.dev.vars` must not set them: its values would win and pin the
 * checkout to one address. Its own file because vite.config.ts runs under
 * Node and cannot import dev-hosts.ts, which uses Bun's shell. */
export const DEV_HOST_KEYS = [
  "APP_URL",
  "APP_HOST",
  "SHARED_LINK_HOST",
  "RESEND_BASE_URL",
  "GOOGLE_EMULATOR_URL",
] as const;
