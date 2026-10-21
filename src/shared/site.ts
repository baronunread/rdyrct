/**
 * Whether this build is rdyrct.com itself, as opposed to somebody's
 * self-hosted copy. Off unless the build sets `VITE_RDYRCT_SITE=1`, which
 * only `bun run deploy:rdyrct`, `bun run dev` and the browser tests do: a
 * fork that runs `bun run build` must not load rdyrct.com's analytics or
 * claim rdyrct.com's URLs in its head tags.
 *
 * A build-time constant, like `import.meta.env.DEV`, so the bundler drops
 * whatever it guards from a self-hosted build.
 */
export const RDYRCT_SITE = import.meta.env.VITE_RDYRCT_SITE === "1";

/** PostHog can only load when the build carries a project token. Forks have
 *  none unless they add their own (see .env.example). */
export const POSTHOG_CONFIGURED = Boolean(
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  import.meta.env.VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN,
);
