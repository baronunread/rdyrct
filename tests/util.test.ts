import { describe, expect, test } from "bun:test";
import {
  buildDestination,
  deviceFromUA,
  isValidHttpUrl,
  randomSlug,
  referrerHost,
  RESERVED_SLUGS,
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
    for (const kw of ["api", "dashboard", "links", "domains", "members", "billing", "settings", "admin", "login", "signup"])
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
    const out = new URL(
      buildDestination("https://example.com/?utm_source=original", UTM),
    );
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

  test("invalid destinations are returned untouched", () => {
    expect(buildDestination("not a url", UTM)).toBe("not a url");
  });
});

describe("deviceFromUA", () => {
  test("classifies user agents", () => {
    expect(deviceFromUA("")).toBe("unknown");
    expect(deviceFromUA("Googlebot/2.1")).toBe("bot");
    expect(deviceFromUA("curl/8.0")).toBe("bot");
    expect(
      deviceFromUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toBe("mobile");
    expect(deviceFromUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(
      "tablet",
    );
    expect(deviceFromUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(
      "desktop",
    );
  });
});

describe("referrerHost", () => {
  test("extracts the hostname", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1")).toBe(
      "news.ycombinator.com",
    );
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
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
  });
});

describe("validateQrFields", () => {
  test("accepts empty and valid fields", () => {
    expect(() => validateQrFields({})).not.toThrow();
    expect(() =>
      validateQrFields({
        qrLogo: "data:image/png;base64,AAAA",
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
      validateQrFields(fields);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(400);
    }
  };

  test("rejects a non-image logo", () => {
    expect400({ qrLogo: "https://example.com/logo.png" });
  });

  test("rejects an oversized logo", () => {
    expect400({ qrLogo: "data:image/png;base64," + "a".repeat(200_000) });
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
});
