import { describe, expect, test } from "bun:test";
import {
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
} from "../src/shared/types";
import { hasAnyQrValue, resolveLook, type QrValues } from "../src/app/lib/qr-look";

describe("resolveLook", () => {
  test("falls back to every default when nothing is set", () => {
    expect(resolveLook({})).toEqual({
      dot: "rounded",
      corner: QR_DEFAULT_CORNER,
      ink: QR_DEFAULT_COLOR,
      eye: QR_DEFAULT_COLOR,
      bg: QR_DEFAULT_BG,
      logo: undefined,
      logoSize: QR_DEFAULT_LOGO_SIZE,
    });
  });

  test("uses each override when set", () => {
    const look = resolveLook({
      logo: "logo.png",
      dotStyle: "dots",
      color: "#111111",
      corner: "square",
      eyeColor: "#222222",
      bg: "#333333",
      logoSize: 0.5,
    });
    expect(look).toEqual({
      dot: "dots",
      corner: "square",
      ink: "#111111",
      eye: "#222222",
      bg: "#333333",
      logo: "logo.png",
      logoSize: 0.5,
    });
  });

  test("eye color falls back to the dot color when unset", () => {
    expect(resolveLook({ color: "#abcabc" }).eye).toBe("#abcabc");
  });

  test("treats transparent background as a literal, not the default", () => {
    expect(resolveLook({ bg: "transparent" }).bg).toBe("transparent");
  });

  test("treats an empty logo string as no logo", () => {
    expect(resolveLook({ logo: "" }).logo).toBeUndefined();
  });
});

describe("hasAnyQrValue", () => {
  const empty: QrValues = {
    qrStyle: "",
    qrColor: "",
    qrLogo: "",
    qrCorner: "",
    qrBg: "",
    qrEyeColor: "",
    qrLogoSize: "",
  };

  test("nothing set is nothing set", () => {
    // An org with no defaults used to answer true here, because the old test
    // compared qrLogoSize against null and it is "" when unset. That org was
    // then shown a read-only grid and told its defaults were locked.
    expect(hasAnyQrValue(empty)).toBe(false);
  });

  test("an unset logo size does not count as a default", () => {
    expect(hasAnyQrValue({ ...empty, qrLogoSize: "" })).toBe(false);
  });

  test("a set logo size does", () => {
    expect(hasAnyQrValue({ ...empty, qrLogoSize: "30" })).toBe(true);
  });

  test("any one field is enough", () => {
    expect(hasAnyQrValue({ ...empty, qrColor: "#ff0000" })).toBe(true);
  });
});
