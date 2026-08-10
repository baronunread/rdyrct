import { afterEach, describe, expect, test } from "bun:test";
import {
  BUFFER_LIMIT,
  bufferBeforeConsent,
  bufferedCount,
  discardBuffer,
  drainBuffer,
} from "../src/app/lib/consent-buffer";
import { FUNNEL } from "../src/app/lib/funnel";

const UNANSWERED = true;
const ANSWERED = false;

afterEach(discardBuffer);

describe("what gets held", () => {
  test("holds a funnel step while the banner is unanswered", () => {
    expect(bufferBeforeConsent(FUNNEL.landingViewed, undefined, UNANSWERED)).toBe(true);
    expect(bufferedCount()).toBe(1);
  });

  test("holds nothing once the banner has been answered", () => {
    // The case that matters: after a rejection, a later Accept in the same
    // document must not replay events the visitor already refused.
    expect(bufferBeforeConsent(FUNNEL.ctaClicked, { placement: "hero_primary" }, ANSWERED)).toBe(
      false,
    );
    expect(bufferedCount()).toBe(0);
  });

  test("holds nothing that is not a funnel step", () => {
    expect(bufferBeforeConsent("qr_code_downloaded", undefined, UNANSWERED)).toBe(false);
    expect(bufferedCount()).toBe(0);
  });

  test("stops at the cap instead of growing without bound", () => {
    for (let i = 0; i < BUFFER_LIMIT + 25; i++) {
      bufferBeforeConsent(FUNNEL.ctaClicked, { i }, UNANSWERED);
    }
    expect(bufferedCount()).toBe(BUFFER_LIMIT);
  });
});

describe("draining", () => {
  test("returns the time each event happened, not the time it was drained", () => {
    const earlier = new Date("2026-08-09T10:00:00.000Z");
    const later = new Date("2026-08-09T10:00:30.000Z");
    bufferBeforeConsent(FUNNEL.landingViewed, undefined, UNANSWERED, earlier);
    bufferBeforeConsent(FUNNEL.ctaClicked, { placement: "hero_primary" }, UNANSWERED, later);

    const drained = drainBuffer();
    expect(drained.map((e) => e.at.toISOString())).toEqual([
      earlier.toISOString(),
      later.toISOString(),
    ]);
    expect(drained[1].properties).toEqual({ placement: "hero_primary" });
  });

  test("keeps the order the steps happened in", () => {
    bufferBeforeConsent(FUNNEL.landingViewed, undefined, UNANSWERED);
    bufferBeforeConsent(FUNNEL.pricingViewed, undefined, UNANSWERED);
    bufferBeforeConsent(FUNNEL.ctaClicked, undefined, UNANSWERED);
    expect(drainBuffer().map((e) => e.event)).toEqual([
      FUNNEL.landingViewed,
      FUNNEL.pricingViewed,
      FUNNEL.ctaClicked,
    ]);
  });

  test("empties, so a second flush cannot send the same events twice", () => {
    bufferBeforeConsent(FUNNEL.landingViewed, undefined, UNANSWERED);
    expect(drainBuffer()).toHaveLength(1);
    expect(drainBuffer()).toHaveLength(0);
  });
});

describe("discarding", () => {
  test("throws everything away, and nothing can be drained afterwards", () => {
    bufferBeforeConsent(FUNNEL.landingViewed, undefined, UNANSWERED);
    bufferBeforeConsent(FUNNEL.ctaClicked, undefined, UNANSWERED);
    discardBuffer();
    expect(bufferedCount()).toBe(0);
    expect(drainBuffer()).toEqual([]);
  });
});
