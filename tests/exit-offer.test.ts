import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  EXIT_OFFER_COOLDOWN_MS,
  EXIT_OFFER_MIN_VISIT_MS,
  exitOfferEligible,
  leftThroughTop,
  readExitOfferMemory,
  rememberExitOfferFinal,
  rememberExitOfferShown,
  type ExitOfferContext,
} from "../src/app/lib/exit-offer";
import { installBrowserGlobals, removeBrowserGlobals } from "./browser-globals";

const NOW = 1_800_000_000_000;

/** A visitor the card should show to: every rule passes. */
const eligible: ExitOfferContext = {
  pathname: "/",
  search: "",
  finePointer: true,
  viewportWidth: 1280,
  signedIn: false,
  enabled: true,
  msOnSite: EXIT_OFFER_MIN_VISIT_MS,
  memory: null,
  now: NOW,
};
const show = (overrides: Partial<ExitOfferContext>) =>
  exitOfferEligible({ ...eligible, ...overrides });

describe("who sees the card", () => {
  test("a signed-out desktop visitor ten seconds in", () => {
    expect(show({})).toBe(true);
  });

  test("never when the deployment runs no offer", () => {
    expect(show({ enabled: false })).toBe(false);
  });

  test("never on a touch device or without hover", () => {
    expect(show({ finePointer: false })).toBe(false);
  });

  test("never below 1024px wide", () => {
    expect(show({ viewportWidth: 1023 })).toBe(false);
    expect(show({ viewportWidth: 390 })).toBe(false);
    expect(show({ viewportWidth: 1024 })).toBe(true);
  });

  test("never to a signed-in visitor", () => {
    expect(show({ signedIn: true })).toBe(false);
  });

  test("not in the first ten seconds", () => {
    expect(show({ msOnSite: EXIT_OFFER_MIN_VISIT_MS - 1 })).toBe(false);
  });
});

describe("where", () => {
  test.each(["/", "/pricing", "/compare/bitly", "/qr-generator", "/utm-builder"])(
    "shows on %s",
    (pathname) => expect(show({ pathname })).toBe(true),
  );

  test.each([
    "/signup",
    "/login",
    "/welcome",
    "/reset-password",
    "/invite/abc",
    "/privacy",
    "/terms",
    "/docs",
    "/docs/api",
    "/report",
    "/dashboard",
    "/links",
    "/billing",
    "/settings",
    "/admin/users",
  ])("never on %s", (pathname) => expect(show({ pathname })).toBe(false));

  test("not on a pricing link already on its way to checkout", () => {
    expect(show({ pathname: "/pricing", search: "?plan=pro" })).toBe(false);
    expect(show({ pathname: "/pricing", search: "?checkout=1" })).toBe(false);
  });

  test("a path that only starts with an excluded word still shows", () => {
    expect(show({ pathname: "/docsify-alternative" })).toBe(true);
  });
});

describe("how often", () => {
  test("once per 30 days", () => {
    expect(show({ memory: { shownAt: NOW - 1000, final: false } })).toBe(false);
    expect(show({ memory: { shownAt: NOW - EXIT_OFFER_COOLDOWN_MS + 1, final: false } })).toBe(
      false,
    );
    expect(show({ memory: { shownAt: NOW - EXIT_OFFER_COOLDOWN_MS, final: false } })).toBe(true);
  });

  test("never again once answered: No thanks, See plans or Copy", () => {
    expect(show({ memory: { shownAt: NOW - 2 * EXIT_OFFER_COOLDOWN_MS, final: true } })).toBe(
      false,
    );
  });
});

describe("the exit", () => {
  test("only through the top edge, out of the page", () => {
    expect(leftThroughTop({ clientY: 0, relatedTarget: null })).toBe(true);
    expect(leftThroughTop({ clientY: -3, relatedTarget: null })).toBe(true);
    expect(leftThroughTop({ clientY: 400, relatedTarget: null })).toBe(false);
  });
});

describe("what the browser remembers", () => {
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
  afterEach(() => removeBrowserGlobals("localStorage"));

  test("shown, then final, keeps the first time it showed", () => {
    rememberExitOfferShown(NOW);
    expect(readExitOfferMemory()).toEqual({ shownAt: NOW, final: false });
    rememberExitOfferFinal(NOW + 5);
    expect(readExitOfferMemory()).toEqual({ shownAt: NOW, final: true });
  });

  test("a final answer survives being shown again", () => {
    rememberExitOfferFinal(NOW);
    rememberExitOfferShown(NOW + 10);
    expect(readExitOfferMemory()?.final).toBe(true);
  });

  test("garbage in storage reads as nothing", () => {
    store.set("rdyrct:exit-offer:v1", "{not json");
    expect(readExitOfferMemory()).toBeNull();
  });
});
