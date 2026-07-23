import { describe, expect, test } from "bun:test";
import {
  buildDestination,
  deviceFromUA,
  EMPTY_UTM,
  isValidHttpUrl,
  normalizeUrl,
  qrLogoKeyFromUrl,
  randomSlug,
  referrerHost,
  RESERVED_SLUGS,
  resolveUtm,
  SLUG_RE,
  uid,
  validateQrFields,
} from "../src/worker/util";

const UTM = {
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "launch",
  utmTerm: "shoes",
  utmContent: "banner",
};

describe("uid / randomSlug", () => {
  test("uid has the requested length and uses the id alphabet", () => {
    expect(uid()).toHaveLength(16);
    expect(uid(32)).toHaveLength(32);
    expect(uid()).toMatch(/^[a-zA-Z0-9]+$/);
  });

  test("uids are unique", () => {
    expect(uid()).not.toBe(uid());
  });

  test("randomSlug is 7 chars from the no-lookalike alphabet", () => {
    const slug = randomSlug();
    expect(slug).toHaveLength(7);
    expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/);
    // no lookalike characters ever appear
    expect(slug).not.toMatch(/[01lo]/);
  });
});

describe("SLUG_RE / RESERVED_SLUGS", () => {
  test("accepts normal slugs", () => {
    expect(SLUG_RE.test("my-link_123")).toBe(true);
    expect(SLUG_RE.test("a")).toBe(true);
  });

  test("rejects invalid slugs", () => {
    expect(SLUG_RE.test("")).toBe(false);
    expect(SLUG_RE.test("has space")).toBe(false);
    expect(SLUG_RE.test("slash/slug")).toBe(false);
    expect(SLUG_RE.test("x".repeat(65))).toBe(false);
  });

  test("app routes are reserved", () => {
    for (const kw of [
      "api",
      "dashboard",
      "analytics",
      "links",
      "domains",
      "members",
      "billing",
      "settings",
      "admin",
      "login",
      "signup",
    ])
      expect(RESERVED_SLUGS.has(kw)).toBe(true);
    expect(RESERVED_SLUGS.has("some-random-word")).toBe(false);
  });
});

describe("buildDestination", () => {
  test("appends all UTM params", () => {
    const out = new URL(buildDestination("https://example.com/page", UTM));
    expect(out.searchParams.get("utm_source")).toBe("newsletter");
    expect(out.searchParams.get("utm_medium")).toBe("email");
    expect(out.searchParams.get("utm_campaign")).toBe("launch");
    expect(out.searchParams.get("utm_term")).toBe("shoes");
    expect(out.searchParams.get("utm_content")).toBe("banner");
  });

  test("existing params on the destination win", () => {
    const out = new URL(buildDestination("https://example.com/?utm_source=original", UTM));
    expect(out.searchParams.get("utm_source")).toBe("original");
    expect(out.searchParams.get("utm_medium")).toBe("email");
  });

  test("empty UTM fields are skipped", () => {
    const out = buildDestination("https://example.com/", {
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
    });
    expect(out).toBe("https://example.com/");
  });

  test("existing query params and fragment survive appended UTM", () => {
    const out = new URL(buildDestination("https://example.com/p?foo=1&bar=2#frag", UTM));
    expect(out.searchParams.get("foo")).toBe("1");
    expect(out.searchParams.get("bar")).toBe("2");
    expect(out.hash).toBe("#frag");
    expect(out.searchParams.get("utm_source")).toBe("newsletter");
    expect(out.searchParams.get("utm_campaign")).toBe("launch");
  });

  test("invalid destinations are returned untouched", () => {
    expect(buildDestination("not a url", UTM)).toBe("not a url");
  });
});

describe("resolveUtm", () => {
  test("extracts params from the destination (quick-create paste)", () => {
    const out = resolveUtm(
      "https://example.com/p?utm_source=nl&utm_medium=email&utm_campaign=launch&foo=1",
      {},
    );
    expect(out).toEqual({
      ...EMPTY_UTM,
      utmSource: "nl",
      utmMedium: "email",
      utmCampaign: "launch",
    });
  });

  test("destination params win over explicit fields", () => {
    const out = resolveUtm("https://example.com/?utm_campaign=from-url", {
      utmCampaign: "from-field",
    });
    expect(out.utmCampaign).toBe("from-url");
  });

  test("fields fill gaps the destination lacks", () => {
    const out = resolveUtm("https://example.com/?utm_campaign=launch", {
      utmSource: "  newsletter  ",
    });
    expect(out.utmCampaign).toBe("launch");
    expect(out.utmSource).toBe("newsletter");
  });

  test("undefined fields fall back to the base, empty strings clear", () => {
    const base = { ...EMPTY_UTM, utmCampaign: "old", utmSource: "keep" };
    const out = resolveUtm("https://example.com/", { utmCampaign: "" }, base);
    expect(out.utmCampaign).toBe("");
    expect(out.utmSource).toBe("keep");
  });

  test("invalid destinations resolve from fields and base only", () => {
    const out = resolveUtm(
      "not a url",
      { utmMedium: "email" },
      { ...EMPTY_UTM, utmSource: "keep" },
    );
    expect(out.utmMedium).toBe("email");
    expect(out.utmSource).toBe("keep");
  });
});

describe("deviceFromUA", () => {
  test("classifies user agents", () => {
    expect(deviceFromUA("")).toBe("unknown");
    expect(deviceFromUA("Googlebot/2.1")).toBe("bot");
    expect(deviceFromUA("curl/8.0")).toBe("bot");
    expect(deviceFromUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(deviceFromUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
  });
});

describe("referrerHost", () => {
  test("extracts the hostname", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });

  test("empty or invalid referrers give an empty string", () => {
    expect(referrerHost("")).toBe("");
    expect(referrerHost("not a url")).toBe("");
  });
});

describe("isValidHttpUrl", () => {
  test("accepts http(s) only", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://example.com")).toBe(true);
    expect(isValidHttpUrl("https://127.0.0.1:8787")).toBe(true);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
  });

  test("rejects malformed hostnames that URL parsing otherwise accepts", () => {
    expect(isValidHttpUrl("https://example.")).toBe(false);
    expect(isValidHttpUrl("https://example.c")).toBe(false);
    expect(isValidHttpUrl("http./path")).toBe(false);
  });
});

describe("normalizeUrl", () => {
  test("preserves a URL with a scheme and adds https to a bare destination", () => {
    expect(normalizeUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(normalizeUrl("example.com/path")).toBe("https://example.com/path");
  });
});

describe("validateQrFields", () => {
  const ORG = "aB3dE5fG7hJ9kL1m";
  const valid = (fields: Parameters<typeof validateQrFields>[0]) => validateQrFields(fields, ORG);
  test("accepts empty and valid fields", () => {
    expect(() => valid({})).not.toThrow();
    expect(() =>
      valid({
        qrLogo: `/api/orgs/${ORG}/qr-logo/n2P4r6T8v0x2z4B6.png`,
        qrStyle: "rounded",
        qrCorner: "dot",
        qrBg: "transparent",
        qrColor: "#17151f",
        qrEyeColor: "#a1b2c3",
      }),
    ).not.toThrow();
  });

  const expect400 = (fields: Parameters<typeof validateQrFields>[0]) => {
    try {
      valid(fields);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(400);
    }
  };

  test("rejects logos that are not uploaded serving URLs", () => {
    expect400({ qrLogo: "https://example.com/logo.png" });
    expect400({ qrLogo: "data:image/png;base64,AAAA" });
    expect400({ qrLogo: `/api/orgs/${ORG}/qr-logo/no-extension` });
  });

  test("rejects a logo uploaded by a different org", () => {
    expect400({
      qrLogo: "/api/orgs/zzz9y8x7w6v5u4t3s/qr-logo/n2P4r6T8v0x2z4B6.png",
    });
  });

  test("accepts org ids with hyphens (the local seed script's format)", () => {
    const seedOrg = "seed-cMjzvojAF3j0";
    expect(() =>
      validateQrFields({ qrLogo: `/api/orgs/${seedOrg}/qr-logo/n2P4r6T8v0x2z4B6.png` }, seedOrg),
    ).not.toThrow();
    expect(qrLogoKeyFromUrl(`/api/orgs/${seedOrg}/qr-logo/n2P4r6T8v0x2z4B6.png`)).toBe(
      `${seedOrg}/n2P4r6T8v0x2z4B6.png`,
    );
  });

  test("the org id charset is irrelevant (matched by construction, not regex)", () => {
    const weirdOrg = "o.rg+1~2";
    const url = `/api/orgs/${weirdOrg}/qr-logo/n2P4r6T8v0x2z4B6.png`;
    expect(() => validateQrFields({ qrLogo: url }, weirdOrg)).not.toThrow();
    expect(qrLogoKeyFromUrl(url)).toBe(`${weirdOrg}/n2P4r6T8v0x2z4B6.png`);
  });

  test("rejects unknown dot/corner styles", () => {
    expect400({ qrStyle: "wobbly" });
    expect400({ qrCorner: "wobbly" });
  });

  test("rejects non-hex colors", () => {
    expect400({ qrBg: "red" });
    expect400({ qrColor: "17151f" });
    expect400({ qrEyeColor: "#12345" });
  });

  test("accepts supported logo sizes and rejects unsafe ones", () => {
    expect(() => valid({ qrLogoSize: 0.65 })).not.toThrow();
    expect400({ qrLogoSize: 0.71 });
  });
});
