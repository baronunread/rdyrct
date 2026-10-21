import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installBrowserGlobals, removeBrowserGlobals } from "./browser-globals";
import { CONSENT_KEY, onConsentLapse, readConsent, writeConsent } from "../src/app/lib/consent";
import { discardBuffer, drainBuffer } from "../src/app/lib/consent-buffer";
import { FUNNEL } from "../src/app/lib/funnel";
import {
  clearHeroVariant,
  heroVariant,
  shownHeroVariant,
  syncHeroVariant,
} from "../src/app/lib/hero-variant";
import posthog, { withHeroVariant } from "../src/app/lib/posthog";

const DAY = 24 * 60 * 60 * 1000;
const ARM_KEY = "rdyrct:hero-variant:v2";
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

describe("before consent", () => {
  test("holds funnel steps, drops everything else, and assigns no arm", () => {
    const shown = heroVariant();
    posthog.capture(FUNNEL.ctaClicked, { placement: "hero_primary" });
    posthog.capture("qr_downloaded");

    const held = drainBuffer();
    expect(shown).toBe("own");
    expect(shownHeroVariant()).toBeNull();
    expect(held).toHaveLength(1);
    expect(held[0].properties).toEqual({ placement: "hero_primary" });
    expect(store.has(ARM_KEY)).toBe(false);
  });
});

describe("the hero copy test", () => {
  test("restores funnel attribution on a fresh document without assigning a new arm", () => {
    writeConsent("accepted");
    store.set(ARM_KEY, "answers");

    for (const event of [FUNNEL.signupViewed, "user_signed_up", FUNNEL.linkCreated]) {
      expect(withHeroVariant(event)).toEqual({ hero_variant: "answers" });
    }
    expect(withHeroVariant("user_signed_in")).toBeUndefined();
    // A signed-in landing visit must not count as a new exposure just because
    // that browser saw the challenger before it signed up.
    expect(withHeroVariant(FUNNEL.landingViewed)).toBeUndefined();
  });

  test("does not attribute a direct signup, a stale arm, or an arm without consent", () => {
    writeConsent("accepted");
    expect(withHeroVariant(FUNNEL.signupViewed)).toBeUndefined();
    // The earlier layout test's arm means nothing to this one.
    store.set("rdyrct:hero-variant:v1", "test");
    store.set(ARM_KEY, "invalid");
    expect(withHeroVariant(FUNNEL.signupViewed)).toBeUndefined();
    store.set(ARM_KEY, "answers");
    writeConsent("rejected");
    expect(withHeroVariant(FUNNEL.signupViewed)).toBeUndefined();
  });

  test("assigns once after consent and keeps that arm", () => {
    writeConsent("accepted");
    Math.random = () => 0.9;

    expect(heroVariant()).toBe("answers");
    expect(store.get(ARM_KEY)).toBe("answers");
    Math.random = () => 0.1;
    expect(heroVariant()).toBe("answers");
  });

  test("tags a landing view with the arm shown after consent", () => {
    writeConsent("accepted");
    Math.random = () => 0.9;
    heroVariant();

    expect(withHeroVariant(FUNNEL.landingViewed, { page: "/" })).toEqual({
      page: "/",
      hero_variant: "answers",
    });
  });

  test("does not give a later arm to events recorded before consent", () => {
    posthog.capture(FUNNEL.landingViewed, { page: "/" });
    writeConsent("accepted");
    Math.random = () => 0.9;
    expect(heroVariant()).toBe("answers");

    expect(drainBuffer()).toEqual([
      expect.objectContaining({ event: FUNNEL.landingViewed, properties: { page: "/" } }),
    ]);
  });
});

describe("keeping the arm in step", () => {
  const answered = { consentReady: true, consented: true, sessionReady: true, authed: false };

  test("waits for consent and the session, and never flips for a signed-in visitor", () => {
    writeConsent("accepted");
    syncHeroVariant({ ...answered, consentReady: false });
    syncHeroVariant({ ...answered, sessionReady: false });
    syncHeroVariant({ ...answered, authed: true });
    expect(store.has(ARM_KEY)).toBe(false);

    syncHeroVariant(answered);
    expect(store.has(ARM_KEY)).toBe(true);
  });

  test("forgets the arm once consent is refused", () => {
    writeConsent("accepted");
    syncHeroVariant(answered);
    syncHeroVariant({ ...answered, consented: false });
    expect(store.has(ARM_KEY)).toBe(false);
  });
});
