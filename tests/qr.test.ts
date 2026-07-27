import { describe, expect, test } from "bun:test";
import {
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
} from "../src/shared/types";
import { resolveLook } from "../src/app/lib/qr-look";

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
