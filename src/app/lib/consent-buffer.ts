// Rejected is not unanswered: queueing after a refusal would let a later Accept in the
// same document replay events the visitor already refused. Memory only, and capped.
import { isFunnelEvent } from "./funnel";
import type { EventProperties } from "./posthog";

export type BufferedEvent = {
  event: string;
  properties?: EventProperties;
  at: Date;
};

const LIMIT = 50;

let pending: BufferedEvent[] = [];

export function bufferBeforeConsent(
  event: string,
  properties: EventProperties | undefined,
  unanswered: boolean,
  now: Date = new Date(),
): boolean {
  if (!unanswered || !isFunnelEvent(event) || pending.length >= LIMIT) return false;
  pending.push({ event, properties, at: now });
  return true;
}

export function drainBuffer(): BufferedEvent[] {
  const queued = pending;
  pending = [];
  return queued;
}

export function discardBuffer() {
  pending = [];
}

export function bufferedCount(): number {
  return pending.length;
}

export const BUFFER_LIMIT = LIMIT;
