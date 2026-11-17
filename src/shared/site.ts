import { PRERENDERED_PUBLIC_PATHS } from "./page-meta";

/** Whether this build is rdyrct.com itself, not a self-hosted copy. vite.config.ts writes it in as a
 * constant, so the bundler drops whatever it guards from a fork. */
export const RDYRCT_SITE = import.meta.env.VITE_RDYRCT_SITE === "1";

export const POSTHOG_CONFIGURED = Boolean(
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  import.meta.env.VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN,
);

export const SITE_ONLY_PATHS: ReadonlySet<string> = new Set([
  ...PRERENDERED_PUBLIC_PATHS,
  "/report",
]);
