import * as Sentry from "@sentry/cloudflare";
import type { JsonValue } from "../shared/types";

/**
 * Structured alert, replacing the old Better Stack webhook. No-ops when
 * SENTRY_DSN is unset (withSentry in index.ts leaves the SDK uninitialized),
 * and never throws: a monitoring hiccup must never block acking a queue
 * message or anything else on the call site's path.
 */
export function captureAlert(events: Array<{ event: string } & Record<string, JsonValue>>): void {
  for (const { event, ...extra } of events) {
    Sentry.captureMessage(event, { level: "error", extra });
  }
}
