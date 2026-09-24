/**
 * The visitor's answer to the analytics banner, and the one way to ask again.
 *
 * Storing the answer is strictly necessary (it is what stops the banner
 * reappearing on every page), so it needs no consent of its own. An answer
 * lapses after six months, the interval the Garante's 2021 cookie guidelines
 * give for asking again, and the visitor can reopen the banner at any time
 * from "Cookie settings" to withdraw or change it (GDPR Art. 7(3)).
 */
import { useSyncExternalStore } from "react";

export const CONSENT_KEY = "rdyrct:consent:v2";
const ANSWERED_AT_KEY = "rdyrct:consent:v2:at";
const LIFETIME_MS = 183 * 24 * 60 * 60 * 1000;

export type ConsentAnswer = "accepted" | "rejected";

/** The stored answer, or null when there is none or it has lapsed. Any value
 *  other than "accepted" counts as a refusal. */
export function readConsent(now: number = Date.now()): ConsentAnswer | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    if (value === null) return null;
    const at = Number(localStorage.getItem(ANSWERED_AT_KEY));
    if (!at) {
      // Answers from before the timestamp existed start their six months now,
      // rather than everybody being asked again on the same day.
      localStorage.setItem(ANSWERED_AT_KEY, String(now));
    } else if (now - at > LIFETIME_MS) {
      localStorage.removeItem(CONSENT_KEY);
      localStorage.removeItem(ANSWERED_AT_KEY);
      // Deferred: this can run inside the banner's snapshot read, which must
      // not notify synchronously.
      queueMicrotask(() => {
        lapseHandler?.();
        notify();
      });
      return null;
    }
    return value === "accepted" ? "accepted" : "rejected";
  } catch {
    // Storage blocked: treat as a refusal, so nothing loads and no banner nags.
    return "rejected";
  }
}

export function writeConsent(answer: ConsentAnswer, now: number = Date.now()) {
  try {
    localStorage.setItem(CONSENT_KEY, answer);
    localStorage.setItem(ANSWERED_AT_KEY, String(now));
  } catch {
    /* ignore */
  }
  bannerOpen = false;
  notify();
}

let lapseHandler: (() => void) | null = null;

/** What to stop when an accepted answer lapses in a page that is still open.
 *  Registered by posthog.ts, which this module cannot import. */
export function onConsentLapse(handler: () => void) {
  lapseHandler = handler;
}

let bannerOpen = false;
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the banner again, whatever the stored answer. */
export function openConsentBanner() {
  bannerOpen = true;
  notify();
}

/** Whether the banner should be on screen: no answer yet, or reopened. */
export function useConsentBannerVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => bannerOpen || readConsent() === null,
    () => false,
  );
}
