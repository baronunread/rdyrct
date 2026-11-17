/** Its own file because vite.config.ts runs under Node and cannot import dev-hosts.ts (Bun's shell).
 * `.dev.vars` must not set these: its values would win and pin the checkout to one address. */
export const DEV_HOST_KEYS = [
  "APP_URL",
  "APP_HOST",
  "SHARED_LINK_HOST",
  "RESEND_BASE_URL",
  "GOOGLE_EMULATOR_URL",
] as const;

/** Filled in only when `.dev.vars` leaves them out (its values win anyway). */
const DEV_DEFAULT_KEYS = ["POLAR_WEBHOOK_SECRET"] as const;

export function devHostVars(env: NodeJS.ProcessEnv): { vars: Record<string, string> } | undefined {
  if (!env.RDYRCT_DEV_HOSTS) return undefined;
  const hosts = DEV_HOST_KEYS.map((key) => [key, env[key] ?? ""]);
  const defaults = DEV_DEFAULT_KEYS.flatMap((key) => (env[key] ? [[key, env[key]]] : []));
  return { vars: Object.fromEntries([...hosts, ...defaults]) };
}
