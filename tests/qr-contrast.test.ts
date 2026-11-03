import { describe, expect, test } from "bun:test";
import { qrContrast } from "../src/app/lib/qr-contrast";
import { isWebAddress } from "../src/app/lib/link-field-errors";

describe("qrContrast", () => {
  const level = (dots: string, corners: string, background: string) =>
    qrContrast({ dots, corners, background }).level;

  test("dark ink on white scans well", () => {
    expect(level("#17151f", "#17151f", "#ffffff")).toBe("strong");
  });
  test("the weaker of dots and corners decides", () => {
    expect(level("#17151f", "#cccccc", "#ffffff")).toBe("low");
  });
  test("mid grey is only fair", () => {
    expect(level("#777777", "#777777", "#ffffff")).toBe("fair");
  });
  test("light on dark is called out even at high contrast", () => {
    expect(level("#ffffff", "#ffffff", "#17151f")).toBe("inverted");
  });
  test("a see-through background depends on the ink", () => {
    expect(level("#17151f", "#17151f", "#ffffff00")).toBe("transparent");
    expect(level("#dddddd", "#dddddd", "transparent")).toBe("low");
  });
});

describe("isWebAddress", () => {
  test("mirrors the server's check", () => {
    expect(isWebAddress("copperkettle winter menu")).toBe(false);
    expect(isWebAddress("copperkettle")).toBe(false);
    expect(isWebAddress("example.com/menu")).toBe(true);
    expect(isWebAddress("https://1.2.3.4/x")).toBe(true);
    expect(isWebAddress("ftp://example.com")).toBe(false);
  });
});
