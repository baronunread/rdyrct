import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installBrowserGlobals, removeBrowserGlobals } from "./browser-globals";
import { CONSENT_KEY, readConsent, writeConsent } from "../src/app/lib/consent";
import { discardBuffer, drainBuffer } from "../src/app/lib/consent-buffer";
import { FUNNEL } from "../src/app/lib/funnel";
import { heroVariant } from "../src/app/lib/hero-variant";
import posthog from "../src/app/lib/posthog";

const DAY = 24 * 60 * 60 * 1000;
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  installBrowserGlobals({
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
  });
});
afterEach(() => {
  discardBuffer();
  removeBrowserGlobals("localStorage");
});

describe("the stored answer", () => {
  test("is null until the visitor answers", () => {
    expect(readConsent()).toBeNull();
  });

  test("holds for six months, then lapses so the banner asks again", () => {
    const answeredAt = Date.UTC(2026, 0, 1);
    writeConsent("accepted", answeredAt);
    expect(readConsent(answeredAt + 180 * DAY)).toBe("accepted");
    expect(readConsent(answeredAt + 190 * DAY)).toBeNull();
    expect(store.has(CONSENT_KEY)).toBe(false);
  });

  test("an answer from before the timestamp existed starts its six months now", () => {
    store.set(CONSENT_KEY, "accepted");
    const now = Date.UTC(2026, 5, 1);
    expect(readConsent(now)).toBe("accepted");
    expect(readConsent(now + 190 * DAY)).toBeNull();
  });

  test("anything but an explicit accept counts as a refusal", () => {
    store.set(CONSENT_KEY, "granted");
    expect(readConsent()).toBe("rejected");
  });
});

describe("the hero A/B test", () => {
  test("funnel steps held before consent say which hero this page showed", () => {
    const shown = heroVariant();
    posthog.capture(FUNNEL.ctaClicked, { placement: "hero_primary" });
    posthog.capture("qr_downloaded");

    const held = drainBuffer();
    expect(held).toHaveLength(1);
    expect(held[0].properties).toEqual({ placement: "hero_primary", hero_variant: shown });
  });

  test("the coin is flipped once per page, not per call", () => {
    expect(new Set([heroVariant(), heroVariant(), heroVariant()]).size).toBe(1);
  });
});
