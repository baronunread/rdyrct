import * as Sentry from "@sentry/cloudflare";
import type { JsonValue } from "../shared/types";

/**
 * No-ops when SENTRY_DSN is unset, and never throws: a monitoring hiccup must
 * not block acking a queue message or anything else on the caller's path.
 */
export function captureAlert(events: Array<{ event: string } & Record<string, JsonValue>>): void {
  for (const { event, ...extra } of events) {
    Sentry.captureMessage(event, { level: "error", extra });
  }
}
