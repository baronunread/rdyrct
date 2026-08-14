import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_ANON_LINKS,
  rememberAnonLink,
  storedAnonLinks,
  type StoredAnonLink,
} from "../src/app/lib/anon-links";

/**
 * The store behind the hero's anonymous links (Direction A of #96).
 *
 * Worth testing directly because every one of its failure modes is silent:
 * an expired link renders as a URL that 404s, a lost claim token turns
 * "keep these 3 links" into a lie, and junk under our key would otherwise
 * decide what requests signup makes.
 */

const HOUR = 60 * 60 * 1000;

/** The two methods this module touches, and nothing else. */
function fakeStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
}

function link(slug: string, expiresIn = 24 * HOUR) {
  return {
    slug,
    url: `https://rdyrct.com/${slug}`,
    claimToken: `tok-${slug}`,
    expiresAt: Date.now() + expiresIn,
  };
}

let store: Map<string, string>;
beforeEach(() => {
  store = fakeStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("keeping links across a reload", () => {
  test("remembers a link with everything the page needs to redraw it", () => {
    rememberAnonLink(link("aaa111"), "https://example.com/one");
    expect(storedAnonLinks()).toEqual([
      {
        slug: "aaa111",
        url: "https://rdyrct.com/aaa111",
        source: "https://example.com/one",
        claimToken: "tok-aaa111",
        expiresAt: expect.any(Number),
      },
    ]);
  });

  test("keeps the newest first, matching the order the hero shows", () => {
    rememberAnonLink(link("first0"), "https://example.com/1");
    rememberAnonLink(link("second"), "https://example.com/2");
    expect(storedAnonLinks().map((l) => l.slug)).toEqual(["second", "first0"]);
  });

  test("does not store the same link twice if it is remembered again", () => {
    rememberAnonLink(link("aaa111"), "https://example.com/one");
    rememberAnonLink(link("aaa111"), "https://example.com/one");
    expect(storedAnonLinks()).toHaveLength(1);
  });
});

describe("the cap", () => {
  test(`stops at ${MAX_ANON_LINKS}, dropping the oldest`, () => {
    for (let i = 0; i < MAX_ANON_LINKS + 2; i++) {
      rememberAnonLink(link(`slug${i}`), `https://example.com/${i}`);
    }
    const kept = storedAnonLinks();
    expect(kept).toHaveLength(MAX_ANON_LINKS);
    // The most recent survive; the first two are gone.
    expect(kept.map((l) => l.slug)).toEqual(["slug4", "slug3", "slug2"]);
  });
});

describe("expiry", () => {
  test("hides a link past its 24 hours, because the server has forgotten it", () => {
    rememberAnonLink(link("expired", -HOUR), "https://example.com/old");
    rememberAnonLink(link("current"), "https://example.com/new");
    expect(storedAnonLinks().map((l) => l.slug)).toEqual(["current"]);
  });

  test("an expired link frees up its slot under the cap", () => {
    for (let i = 0; i < MAX_ANON_LINKS; i++) {
      rememberAnonLink(link(`old${i}`, -HOUR), `https://example.com/${i}`);
    }
    expect(storedAnonLinks()).toHaveLength(0);
    rememberAnonLink(link("fresh0"), "https://example.com/fresh");
    expect(storedAnonLinks().map((l) => l.slug)).toEqual(["fresh0"]);
  });
});

describe("junk under our key", () => {
  const KEY = "rdyrct:anon-links:v3";

  test("discards anything that is not an array", () => {
    for (const junk of ['{"slug":"x"}', '"a string"', "42", "not json at all"]) {
      store.set(KEY, junk);
      expect(storedAnonLinks()).toEqual([]);
    }
  });

  test("drops entries missing the fields a claim needs", () => {
    // A half-record would render a link with no claim token, which looks
    // keepable and is not.
    store.set(
      KEY,
      JSON.stringify([
        { slug: "good00", url: "u", source: "s", claimToken: "t", expiresAt: Date.now() + HOUR },
        { slug: "no-token", url: "u", source: "s", expiresAt: Date.now() + HOUR },
        null,
      ]),
    );
    expect(storedAnonLinks().map((l: StoredAnonLink) => l.slug)).toEqual(["good00"]);
  });

  test("survives storage that throws, so the form still works", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(storedAnonLinks()).toEqual([]);
    expect(() => rememberAnonLink(link("aaa111"), "https://example.com")).not.toThrow();
  });
});
