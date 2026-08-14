/**
 * The pre-consent event queue.
 *
 * Split out of posthog.ts because it is not really PostHog's concern, and
 * because in there it was untestable: the only observable was network traffic
 * from an SDK that will not even bootstrap when a test intercepts its config
 * request. As a module of its own it is plain data, and the rules that matter
 * can be asserted directly.
 *
 * The rules:
 *  - Only funnel steps are held. A QR download by someone who has not
 *    answered the banner belongs to no funnel.
 *  - Only while consent is *unanswered*. Rejected is not the same as
 *    unanswered: queueing after a refusal would let a later Accept in the
 *    same document replay events the visitor already said no to.
 *  - In memory only. Nothing is written down, so a reload discards it.
 *  - Capped, so a long session that never answers cannot grow without bound.
 */
import { isFunnelEvent } from "./funnel";
import type { EventProperties } from "./posthog";

export type BufferedEvent = {
  event: string;
  properties?: EventProperties;
  /** When it actually happened, not when it was flushed. */
  at: Date;
};

const LIMIT = 50;

let pending: BufferedEvent[] = [];

/**
 * @param unanswered whether the visitor has yet to answer the banner
 * @returns whether the event was held
 */
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

/** Hands over everything held and empties the queue. */
export function drainBuffer(): BufferedEvent[] {
  const queued = pending;
  pending = [];
  return queued;
}

/** Throws the queue away unsent. */
export function discardBuffer() {
  pending = [];
}

/** Test seam: how many events are currently held. */
export function bufferedCount(): number {
  return pending.length;
}

export const BUFFER_LIMIT = LIMIT;
