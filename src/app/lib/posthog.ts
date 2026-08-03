import posthog from "posthog-js";

const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string | undefined;
const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;

if (typeof window !== "undefined") {
  if (!token) {
    if (import.meta.env.DEV) {
      throw new Error(
        "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
  } else if (!host) {
    if (import.meta.env.DEV) {
      throw new Error(
        "VITE_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_HOST is configured",
      );
    }
  } else {
    posthog.init(token, {
      api_host: host,
      defaults: "2026-01-30",
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
      },
    });
  }
}

export default posthog;
