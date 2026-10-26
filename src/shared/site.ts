import { PRERENDERED_PUBLIC_PATHS } from "./page-meta";

/**
 * Whether this build is rdyrct.com itself, as opposed to somebody's
 * self-hosted copy. scripts/site-mode.ts decides, from the `VITE_RDYRCT_SITE`
 * flag, and vite.config.ts writes the answer in here. A fork must
 * not load rdyrct.com's analytics, claim its URLs, or serve its landing,
 * pricing and legal pages as the fork's own.
 *
 * A build-time constant, like `import.meta.env.DEV`, so the bundler drops
 * whatever it guards from a self-hosted build.
 */
export const RDYRCT_SITE = import.meta.env.VITE_RDYRCT_SITE === "1";

/** PostHog can only load when the build carries a project token. Forks have
 *  none unless they add their own (see .env.build.example). */
export const POSTHOG_CONFIGURED = Boolean(
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  import.meta.env.VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN,
);

/** The pages only rdyrct.com serves: its landing, pricing, docs, comparisons,
 *  legal text and abuse form. A self-hosted build answers each with a 404. */
export const SITE_ONLY_PATHS: ReadonlySet<string> = new Set([
  ...PRERENDERED_PUBLIC_PATHS,
  "/report",
]);
