import { describe, expect, test } from "bun:test";
import { displayHost, displayPath } from "../src/app/lib/display-url";

describe("displayHost", () => {
  test("decodes every punycode label", () => {
    expect(displayHost("xn--krzer-kva.xn--bckerei-mller-strae-2tb1gx1a.test")).toBe(
      "kürzer.bäckerei-müller-straße.test",
    );
    expect(displayHost("xn--mnchen-3ya.de")).toBe("münchen.de");
    expect(displayHost("xn--fiqs8s.cn")).toBe("中国.cn");
  });

  test("leaves ASCII hosts and broken labels alone", () => {
    expect(displayHost("go.example.com")).toBe("go.example.com");
    expect(displayHost("xn--zz.example.com")).toBe("xn--zz.example.com");
  });
});

describe("displayPath", () => {
  test("decodes escapes for reading", () => {
    expect(displayPath("/b%C3%A4ckerei?emoji=%F0%9F%8E%89")).toBe("/bäckerei?emoji=🎉");
  });

  test("keeps reserved escapes and survives a malformed one", () => {
    expect(displayPath("/a%2Fb")).toBe("/a%2Fb");
    expect(displayPath("/%E0%A4%A")).toBe("/%E0%A4%A");
  });
});
