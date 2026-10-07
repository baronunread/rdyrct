import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installBrowserGlobals, removeBrowserGlobals } from "./browser-globals";
import { CONSENT_KEY, onConsentLapse, readConsent, writeConsent } from "../src/app/lib/consent";
import { discardBuffer, drainBuffer } from "../src/app/lib/consent-buffer";
import { FUNNEL } from "../src/app/lib/funnel";
import { clearHeroVariant, heroVariant, shownHeroVariant } from "../src/app/lib/hero-variant";
import posthog, { withHeroVariant } from "../src/app/lib/posthog";

const DAY = 24 * 60 * 60 * 1000;
let store: Map<string, string>;
const originalRandom = Math.random;

beforeEach(() => {
  store = new Map();
  installBrowserGlobals({
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
  });
  clearHeroVariant();
});
afterEach(() => {
  discardBuffer();
  removeBrowserGlobals("localStorage");
  Math.random = originalRandom;
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

  test("a lapse in an open page stops what the answer allowed", async () => {
    const stopped: string[] = [];
    onConsentLapse(() => stopped.push("stopped"));
    const answeredAt = Date.UTC(2026, 0, 1);
    writeConsent("accepted", answeredAt);

    readConsent(answeredAt + 10 * DAY);
    await Promise.resolve();
    expect(stopped).toEqual([]);

    readConsent(answeredAt + 190 * DAY);
    await Promise.resolve();
    expect(stopped).toEqual(["stopped"]);
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
  test("does not assign or tag a variant before consent", () => {
    const shown = heroVariant();
    posthog.capture(FUNNEL.ctaClicked, { placement: "hero_primary" });
    posthog.capture("qr_downloaded");

    const held = drainBuffer();
    expect(shown).toBe("control");
    expect(shownHeroVariant()).toBeNull();
    expect(held).toHaveLength(1);
    expect(held[0].properties).toEqual({ placement: "hero_primary" });
    expect(store.has("rdyrct:hero-variant:v1")).toBe(false);
  });

  test("assigns once after consent and persists that assignment", () => {
    writeConsent("accepted");
    Math.random = () => 0.9;

    expect(heroVariant()).toBe("test");
    expect(store.get("rdyrct:hero-variant:v1")).toBe("test");
    Math.random = () => 0.1;
    expect(heroVariant()).toBe("test");
  });

  test("tags a landing view with the arm shown after consent", () => {
    writeConsent("accepted");
    Math.random = () => 0.9;
    heroVariant();

    expect(withHeroVariant(FUNNEL.landingViewed, { page: "/" })).toEqual({
      page: "/",
      hero_variant: "test",
    });
  });

  test("does not assign a later arm to events recorded before consent", () => {
    posthog.capture(FUNNEL.landingViewed, { page: "/" });
    writeConsent("accepted");
    Math.random = () => 0.9;
    expect(heroVariant()).toBe("test");

    expect(drainBuffer()).toEqual([
      expect.objectContaining({
        event: FUNNEL.landingViewed,
        properties: { page: "/" },
      }),
    ]);
  });
});
