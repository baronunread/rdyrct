import { describe, expect, test } from "bun:test";
import { QR_DEFAULT_BG, QR_DEFAULT_COLOR } from "../src/shared/types";
import { orgQrFrom, qrFallbacks, resolveQrLook, type OrgQr } from "../src/app/lib/org-qr";

describe("orgQrFrom", () => {
  test("defaults every field when there's no org", () => {
    expect(orgQrFrom(null)).toEqual({
      logo: "",
      style: "",
      color: "",
      corner: "",
      bg: "",
      eyeColor: "",
      logoSize: null,
    });
    expect(orgQrFrom(undefined)).toEqual(orgQrFrom(null));
  });

  test("carries over every set field and defaults the rest", () => {
    expect(
      orgQrFrom({
        qrLogo: "logo.png",
        qrStyle: "dots",
        qrColor: "#111111",
        qrCorner: "square",
        qrBg: "#222222",
        qrEyeColor: "#333333",
        qrLogoSize: 0.5,
      } as never),
    ).toEqual({
      logo: "logo.png",
      style: "dots",
      color: "#111111",
      corner: "square",
      bg: "#222222",
      eyeColor: "#333333",
      logoSize: 0.5,
    });
  });
});

const emptyOrgQr: OrgQr = {
  logo: "",
  style: "",
  color: "",
  corner: "",
  bg: "",
  eyeColor: "",
  logoSize: null,
};

describe("resolveQrLook", () => {
  test("has no logo and empty style/color fields when nothing is set", () => {
    expect(resolveQrLook({}, emptyOrgQr)).toEqual({
      logo: undefined,
      dotStyle: "",
      color: "",
      corner: "",
      eyeColor: "",
      bg: "",
      logoSize: undefined,
    });
  });

  test("falls back to the org default when the link doesn't override a field", () => {
    const orgQr: OrgQr = { ...emptyOrgQr, logo: "org-logo.png", color: "#abcabc", logoSize: 0.25 };
    expect(resolveQrLook({}, orgQr)).toMatchObject({
      logo: "org-logo.png",
      color: "#abcabc",
      logoSize: 0.25,
    });
  });

  test("prefers the link's own override over the org default", () => {
    const orgQr: OrgQr = { ...emptyOrgQr, logo: "org-logo.png", color: "#abcabc" };
    expect(resolveQrLook({ qrLogo: "link-logo.png", qrColor: "#ffffff" }, orgQr)).toMatchObject({
      logo: "link-logo.png",
      color: "#ffffff",
    });
  });

  test("coerces a string logoSize override to a number", () => {
    expect(resolveQrLook({ qrLogoSize: "0.65" as never }, emptyOrgQr).logoSize).toBe(0.65);
  });
});

describe("qrFallbacks", () => {
  test("uses the built-in defaults when nothing is set", () => {
    expect(qrFallbacks({}, emptyOrgQr)).toEqual({
      dotColor: QR_DEFAULT_COLOR,
      eyeColor: QR_DEFAULT_COLOR,
      bg: QR_DEFAULT_BG,
    });
  });

  test("eye color falls back to the dot color, then the default", () => {
    const orgQr: OrgQr = { ...emptyOrgQr, color: "#abcabc" };
    expect(qrFallbacks({}, orgQr).eyeColor).toBe("#abcabc");
    expect(qrFallbacks({ qrColor: "#ffffff" }, orgQr).eyeColor).toBe("#ffffff");
  });

  test("treats a transparent org background as unset", () => {
    expect(qrFallbacks({}, { ...emptyOrgQr, bg: "transparent" }).bg).toBe(QR_DEFAULT_BG);
    expect(qrFallbacks({}, { ...emptyOrgQr, bg: "#222222" }).bg).toBe("#222222");
  });
});
