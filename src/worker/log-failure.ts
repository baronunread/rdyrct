import { createLoggerStorage } from "evlog/toolkit/storage";
import * as v from "valibot";
import type { JsonValue } from "../shared/types";

// Its own module, free of cloudflare:workers, so code the Bun unit tests
// load (rate-limit.ts) can report through it.

export const { storage: activeLog } = createLoggerStorage("wide event", "evlog:hono");

function describe(cause: unknown): string {
  const text = v.safeParse(v.string(), cause);
  if (text.success) return text.output;
  try {
    return JSON.stringify(cause) ?? "";
  } catch {
    return "";
  }
}

type Fields = { [key: string]: JsonValue };

export function logFailure(message: string, cause?: unknown, fields?: Fields): void {
  const log = activeLog.getStore();
  if (!log) {
    console.error(message, fields ?? "", cause ?? "");
    return;
  }
  const error = cause instanceof Error ? `${cause.name}: ${cause.message}` : describe(cause);
  log.warn(message);
  log.set({ failures: [{ message, error, ...fields }] });
}
