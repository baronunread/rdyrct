// Storing the answer is strictly necessary, so it needs no consent. An answer lapses
// after six months (Garante's 2021 cookie guidelines); GDPR Art. 7(3) needs a way to withdraw.
import { useSyncExternalStore } from "react";

export const CONSENT_KEY = "rdyrct:consent:v2";
const ANSWERED_AT_KEY = "rdyrct:consent:v2:at";
const LIFETIME_MS = 183 * 24 * 60 * 60 * 1000;
const browserReady = () => true;
const serverSnapshot = () => false;

export type ConsentAnswer = "accepted" | "rejected";

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
  } catch {}
  bannerOpen = false;
  notify();
}

let lapseHandler: (() => void) | null = null;

// Registered by posthog.ts, which this module cannot import.
export function onConsentLapse(handler: () => void) {
  lapseHandler = handler;
}

let bannerOpen = false;
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}

if ("window" in globalThis) {
  globalThis.window.addEventListener("storage", (event) => {
    if (event.key === CONSENT_KEY || event.key === ANSWERED_AT_KEY) notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnalyticsConsent() {
  const ready = useSyncExternalStore(subscribe, browserReady, serverSnapshot);
  const accepted = useSyncExternalStore(
    subscribe,
    () => readConsent() === "accepted",
    serverSnapshot,
  );
  return { ready, accepted: ready && accepted };
}

export function openConsentBanner() {
  bannerOpen = true;
  notify();
}

export function useConsentBannerVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => bannerOpen || readConsent() === null,
    () => false,
  );
}
